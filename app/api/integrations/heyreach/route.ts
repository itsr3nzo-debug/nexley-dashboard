/**
 * HeyReach — LinkedIn outreach connect handler.
 *
 * Auth: an API key (X-API-KEY header) + an MCP connection URL. Both are
 * issued in HeyReach: Settings → Integrations → HeyReach API (key) and
 * Settings → Integrations → HeyReach MCP Server (MCP URL). The pair lets
 * the AI Employee call HeyReach via the official MCP server (npx mcp-remote
 * <URL>) for high-level workflows, AND drop down to direct REST calls
 * (X-API-KEY auth) when the MCP layer doesn't cover a specific need.
 *
 * Validation flow:
 *  1. Normalise + sanity-check the apiKey shape (non-empty, reasonable length)
 *  2. Validate via GET https://api.heyreach.io/api/public/auth/CheckApiKey
 *     with the apiKey as X-API-KEY header. 200 = valid; 401/403 = bad key.
 *  3. (Best-effort) sanity-check the MCP URL is heyreach-issued (host must end
 *     in .heyreach.io OR be the documented mcp-remote pattern). We do NOT
 *     hit the MCP URL during validation — it's an SSE/HTTP MCP endpoint
 *     and probing it from a webserver is expensive and noisy.
 *  4. Encrypt the compound credential {apiKey, mcpUrl} as JSON, upsert
 *     integrations row, enqueue push_integration_creds for the VPS watcher.
 *
 * DELETE /api/integrations/heyreach — disconnects.
 *
 * Security:
 *  - The MCP URL contains an embedded auth token. We encrypt it at rest.
 *  - The X-API-KEY is similarly encrypted. Both flow to the VPS as a
 *    chmod 600 JSON file (handled by the integrations-watcher).
 *  - We never log the apiKey or the full MCP URL — only the workspace ID
 *    fragment that appears in HeyReach's MCP URL pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { encryptToken } from '@/lib/encryption'

const HEYREACH_API_BASE = 'https://api.heyreach.io/api/public'

function svc() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getSession() {
  const cookieStore = await cookies()
  const s = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await s.auth.getUser()
  return {
    user,
    clientId: (user?.app_metadata?.client_id as string | undefined) ?? null,
    role: (user?.app_metadata?.role as string | undefined) ?? 'owner',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Validation helpers
// ──────────────────────────────────────────────────────────────────────────

interface HeyReachValidation {
  ok: boolean
  error?: string
  detail?: string
  workspaceHint?: string   // extracted from the MCP URL for the audit trail
}

function isPlausibleApiKey(s: string): boolean {
  // HeyReach API keys are opaque tokens. We just want to reject obvious junk
  // before burning a network call. Empirically: alnum + dashes, 20-100 chars.
  return typeof s === 'string' && /^[A-Za-z0-9_\-=]{20,200}$/.test(s)
}

function isPlausibleMcpUrl(s: string): { ok: boolean; workspaceHint?: string; reason?: string } {
  try {
    const u = new URL(s.trim())
    if (u.protocol !== 'https:') return { ok: false, reason: 'must be https://' }
    // HeyReach MCP URLs we've seen end in .heyreach.io. Be lenient — they may
    // change subdomain (api., mcp., etc.) so just check the second-level domain.
    const hostParts = u.hostname.split('.')
    const sld = hostParts.slice(-2).join('.')
    if (sld !== 'heyreach.io') {
      return { ok: false, reason: `expected hostname under heyreach.io, got ${u.hostname}` }
    }
    // The MCP URL pattern typically embeds a workspace + key in the path or
    // query. We log a non-secret hint (last 8 chars of path) for the audit
    // trail without storing or echoing the auth.
    const tail = u.pathname.slice(-8) || u.search.slice(-8) || 'unknown'
    return { ok: true, workspaceHint: `…${tail}` }
  } catch {
    return { ok: false, reason: 'malformed URL' }
  }
}

async function validateHeyReach(apiKey: string, mcpUrl: string): Promise<HeyReachValidation> {
  if (!isPlausibleApiKey(apiKey)) {
    return {
      ok: false,
      error: 'API key looks malformed',
      detail: 'Should be a long alphanumeric token from HeyReach Settings → Integrations → HeyReach API.',
    }
  }

  const mcp = isPlausibleMcpUrl(mcpUrl)
  if (!mcp.ok) {
    return {
      ok: false,
      error: 'MCP URL is not a valid HeyReach URL',
      detail: `Expected an https URL under heyreach.io (${mcp.reason ?? 'unknown'}). Generate one at Settings → Integrations → HeyReach MCP Server → New MCP Key.`,
    }
  }

  // Validate the API key against the official check endpoint. Cheap call,
  // documented 200/401 semantics.
  let res: Response
  try {
    res = await fetch(`${HEYREACH_API_BASE}/auth/CheckApiKey`, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    return {
      ok: false,
      error: 'Could not reach HeyReach',
      detail: `Network error contacting ${HEYREACH_API_BASE}/auth/CheckApiKey — ${String(e).slice(0, 120)}. Try again, or contact HeyReach support if it persists.`,
    }
  }

  if (res.status === 200) {
    return { ok: true, workspaceHint: mcp.workspaceHint }
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: 'API key was rejected by HeyReach',
      detail: 'The X-API-KEY header was not accepted. Re-copy the key from HeyReach Settings → Integrations → HeyReach API — make sure there are no trailing spaces.',
    }
  }
  return {
    ok: false,
    error: `HeyReach returned HTTP ${res.status}`,
    detail: 'Unexpected response during validation. Try again, or contact HeyReach support if it persists.',
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — connect HeyReach
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can connect integrations' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const apiKey = (body.apiKey as string | undefined)?.trim()
  const mcpUrl = (body.mcpUrl as string | undefined)?.trim()

  if (!apiKey || !mcpUrl) {
    return NextResponse.json(
      { error: 'apiKey and mcpUrl are both required' },
      { status: 400 },
    )
  }

  // Validate against the live HeyReach API.
  const v = await validateHeyReach(apiKey, mcpUrl)
  if (!v.ok) {
    return NextResponse.json({ error: v.error, detail: v.detail }, { status: 400 })
  }

  // Encrypt the compound credential.
  const credentialBlob = JSON.stringify({
    apiKey,
    mcpUrl,
    schemaVersion: 1,
  })
  const encrypted = encryptToken(credentialBlob)

  const supabase = svc()
  const { data: row, error } = await supabase
    .from('integrations')
    .upsert(
      {
        client_id: clientId,
        provider: 'heyreach',
        status: 'connected',
        account_email: null,
        account_name: 'HeyReach workspace',
        provider_user_id: v.workspaceHint ?? null,
        access_token_enc: encrypted,
        refresh_token_enc: null,
        token_expires_at: null,
        scope: 'linkedin_outreach',
        last_synced_at: new Date().toISOString(),
        last_health_check_at: new Date().toISOString(),
        health_failure_count: 0,
        metadata: {
          auth_mode: 'compound_pat',
          workspace_hint: v.workspaceHint ?? null,
          connected_at: new Date().toISOString(),
          connected_by: user?.email ?? null,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,provider' },
    )
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit + enqueue VPS push.
  try {
    await supabase.rpc('log_integration_event', {
      p_integration_id: row.id,
      p_client_id: clientId,
      p_provider: 'heyreach',
      p_event: 'connected',
      p_payload: { workspace_hint: v.workspaceHint ?? null },
      p_actor_user_id: user?.id ?? null,
    })
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'push_integration_creds',
      triggered_by: 'dashboard:heyreach:connect',
      meta: { provider: 'heyreach' },
    })
  } catch (e) {
    console.error('[heyreach-connect] post-insert side effects failed', e)
  }

  return NextResponse.json({
    ok: true,
    provider: 'heyreach',
    workspace_hint: v.workspaceHint ?? null,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — disconnect HeyReach
// ──────────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest) {
  const { user, clientId, role } = await getSession()
  if (!clientId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (role !== 'owner' && role !== 'super_admin') {
    return NextResponse.json({ error: 'Only owners can disconnect' }, { status: 403 })
  }

  const supabase = svc()
  const { data: row } = await supabase
    .from('integrations')
    .select('id')
    .eq('client_id', clientId)
    .eq('provider', 'heyreach')
    .maybeSingle()

  const { error } = await supabase
    .from('integrations')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', 'heyreach')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (row?.id) {
    try {
      await supabase.rpc('log_integration_event', {
        p_integration_id: row.id,
        p_client_id: clientId,
        p_provider: 'heyreach',
        p_event: 'disconnected',
        p_payload: {},
        p_actor_user_id: user?.id ?? null,
      })
    } catch {}
  }
  try {
    await supabase.from('provisioning_queue').insert({
      client_id: clientId,
      action: 'revoke_integration_creds',
      triggered_by: 'dashboard:heyreach:disconnect',
      meta: { provider: 'heyreach' },
    })
  } catch {}

  return NextResponse.json({ ok: true })
}
