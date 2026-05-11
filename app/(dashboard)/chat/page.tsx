import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getUserSession } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import ChatApp from '@/components/chat/ChatApp';
import '@/styles/nexley-chat.css';

export const metadata: Metadata = { title: 'Chat | Nexley AI' };

// ── Temporary kill-switch ────────────────────────────────────────────
// Set to false to bring the dashboard chat back online. Renders a
// maintenance card in place of the chat UI. Composer + Realtime + the
// VPS bridges are all bypassed while this is true.
const CHAT_TEMPORARILY_DISABLED = true;

interface ChatPageProps {
  searchParams: Promise<{ client?: string }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const session = getUserSession(user);
  const { client: queryClientId } = await searchParams;

  if (CHAT_TEMPORARILY_DISABLED) {
    return (
      <div className="max-w-2xl mx-auto mt-16 px-6">
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground mb-2">
            Chat temporarily down
          </h1>
          <p className="text-sm text-muted-foreground">
            The dashboard chat is paused for maintenance. We&apos;ll have it back online shortly —
            in the meantime, message your AI Employee on WhatsApp.
          </p>
        </div>
      </div>
    );
  }

  // ── Which client are we chatting as? ─────────────────────────────
  // owner/member: always their assigned client_id.
  // super_admin: picks a client via ?client=<uuid>. If none picked, they
  //   see a picker (client list) to choose.
  let activeClientId: string | null = null;
  if (session.role === 'super_admin') {
    activeClientId = queryClientId || null;
  } else {
    activeClientId = session.clientId;
  }

  // Super_admin without a selected client → render picker
  if (session.role === 'super_admin' && !activeClientId) {
    // Use service-role for this query. The normal user-scoped `supabase` client
    // runs under the super_admin's JWT, which still has a `client_id` in
    // app_metadata — RLS on `clients` restricts reads to rows where id matches
    // that, so a super_admin would see only their own client (1 row) and miss
    // every other tenant in the fleet. Service role bypasses RLS so the picker
    // actually shows the whole fleet for shadow-chat.
    const pickerReader = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: allClients } = await pickerReader
      .from('clients')
      .select('id, name, slug, onboarding_completed, subscription_status, vps_ready, vps_ip')
      .order('name', { ascending: true });

    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">Chat — admin view</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Pick a client to chat as their AI Employee. Messages hit the live client
          agent on its own Hetzner VPS. Clients without a deployed agent are greyed
          out — the chat UI loads but replies will time out.
        </p>
        <div className="space-y-2">
          {(allClients ?? []).map((c) => {
            const hasAgent = Boolean((c as { vps_ready?: boolean; vps_ip?: string }).vps_ready && (c as { vps_ip?: string }).vps_ip);
            return (
              <a
                key={c.id}
                href={`/chat?client=${c.id}`}
                className={
                  'flex items-center justify-between rounded-md border px-4 py-3 transition-colors ' +
                  (hasAgent
                    ? 'border-border bg-card hover:bg-accent hover:text-accent-foreground'
                    : 'border-border/60 bg-card/50 opacity-70 hover:opacity-100 hover:bg-accent/50')
                }
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate flex items-center gap-2">
                    {c.name || c.slug}
                    {hasAgent ? (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-success/10 text-success px-1.5 h-[18px] text-[10px] font-medium">
                        <span className="h-1 w-1 rounded-full bg-success" />
                        agent online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        no agent
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {c.slug} · {c.subscription_status || 'no plan'} ·{' '}
                    {c.onboarding_completed ? 'onboarded' : 'onboarding'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">→</span>
              </a>
            );
          })}
          {(!allClients || allClients.length === 0) && (
            <div className="text-sm text-muted-foreground">No clients yet.</div>
          )}
        </div>
      </div>
    );
  }

  if (!activeClientId) {
    return (
      <div className="p-8 text-sm text-destructive">
        No client assigned to your account. Contact support.
      </div>
    );
  }

  // Fetch business name + owner for the active client.
  // Super_admins don't have a client_id in their JWT so the clients-table RLS
  // would return 0 rows — use service-role for admin, user-scoped for owner/member.
  let clientName = 'My Business';
  let ownerName: string | undefined;
  const reader = session.role === 'super_admin'
    ? createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : supabase;
  const { data: client } = await reader
    .from('clients')
    .select('name, contact_name')
    .eq('id', activeClientId)
    .maybeSingle();
  if (client?.name) clientName = client.name;
  if (typeof (client as { contact_name?: string } | null)?.contact_name === 'string') {
    ownerName = (client as { contact_name?: string }).contact_name;
  }

  return (
    // Mobile (below lg): position: fixed pinned between the layout's top
    // chrome (breadcrumb + optional banners, reserving 146px) and the
    // MobileNav (fixed bottom-0, ~72px). Using `fixed` sidesteps the
    // fragile calc-math that previously let the composer render UNDER the
    // bottom nav.
    //   Desktop (lg+): static flow with the original calc height. We used
    // to negate the parent's padding (`-m-4 sm:-m-6 lg:-m-8`) to bleed
    // edge-to-edge, but that pulled the chat UP into the breadcrumb row
    // — the old className also had invalid Tailwind prefixes (`lg:sm:`,
    // `lg:lg:`) that silently failed. Cleanest fix: keep the chat inside
    // its padded lane so the breadcrumb + admin banner never collide.
    <div className="fixed inset-x-0 top-[146px] bottom-[72px] lg:static lg:inset-auto lg:h-[calc(100vh-140px)]">
      <ChatApp
        clientId={activeClientId}
        clientName={clientName}
        userEmail={user.email || ''}
        ownerName={ownerName}
        isAdminView={session.role === 'super_admin'}
      />
    </div>
  );
}
