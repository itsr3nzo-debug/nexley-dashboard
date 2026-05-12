import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveClientId } from '@/lib/chat/resolve-client';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { CHAT_TEMPORARILY_DISABLED, CHAT_DISABLED_MESSAGE } from '@/lib/chat/feature-flags';

/** GET /api/chat/sessions?client=<uuid?> — list sessions for the resolved client. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Hard denylist — see lib/auth/chat-denylist.ts.
  const { isChatBlocked } = await import('@/lib/auth/chat-denylist');
  if (isChatBlocked(user.id)) {
    return NextResponse.json({ error: 'account_suspended', message: 'Your account is suspended. Contact the Nexley team.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const explicit = url.searchParams.get('client') || undefined;
  // 2026-05-12 (DA-R5 parity gap) — F8 spoof parity with sessions/[id]:
  // non-admin caller passing cross-tenant client_id silently fell back to
  // their own client and returned an empty list. Functionally low-risk (RLS
  // scoped reads anyway), but inconsistent with the single-id route which
  // 403s on spoof. Now uniformly 403.
  const { clientId, isAdminOverride, spoofRejected } = resolveClientId(user, explicit);
  if (spoofRejected) {
    return NextResponse.json({ error: 'client_id override is admin-only' }, { status: 403 });
  }
  if (!clientId) return NextResponse.json({ sessions: [] });

  const reader = isAdminOverride
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;

  const { data, error } = await reader
    .from('agent_chat_sessions')
    .select('id, title, pinned, created_at, updated_at')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

/** POST /api/chat/sessions — create a new session for the resolved client. */
export async function POST(req: Request) {
  if (CHAT_TEMPORARILY_DISABLED) {
    return NextResponse.json(
      { error: 'chat_disabled', message: CHAT_DISABLED_MESSAGE },
      { status: 503 }
    );
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Hard denylist — see lib/auth/chat-denylist.ts.
  const { isChatBlocked } = await import('@/lib/auth/chat-denylist');
  if (isChatBlocked(user.id)) {
    return NextResponse.json({ error: 'account_suspended', message: 'Your account is suspended. Contact the Nexley team.' }, { status: 403 });
  }

  let title = 'New chat';
  let explicit: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.title === 'string') title = body.title.slice(0, 120);
    if (typeof body?.client_id === 'string') explicit = body.client_id;
  } catch {
    // ignore — default title, no explicit
  }

  // 2026-05-12 (DA-R5 parity gap) — same fix on POST.
  const { clientId, isAdminOverride, spoofRejected } = resolveClientId(user, explicit);
  if (spoofRejected) {
    return NextResponse.json({ error: 'client_id override is admin-only' }, { status: 403 });
  }
  if (!clientId) return NextResponse.json({ error: 'no client' }, { status: 400 });

  const writer = isAdminOverride
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;

  const { data, error } = await writer
    .from('agent_chat_sessions')
    .insert({ client_id: clientId, user_id: user.id, title })
    .select('id, title, created_at, updated_at, pinned')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit admin-impersonated session creation so the trail isn't
  // limited to the message-send path. Deliberately blocking await.
  if (isAdminOverride && data?.id) {
    try {
      const svc = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await svc.from('admin_audit_log').insert({
        admin_user_id: user.id,
        admin_email: user.email ?? null,
        client_id: clientId,
        action: 'chat_session_create',
        target_kind: 'session',
        target_id: data.id,
        context: { title },
      });
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ session: data });
}
