/**
 * POST /api/agent/log-action
 *
 * The AI Employee (from the VPS) posts an agent action. Used by every
 * value-tracking skill (message_handled, booking_confirmed, quote_sent, etc.).
 *
 * Auth: agent_api_key (agent_config.agent_api_key) in Authorization header.
 * We intentionally do NOT use the service-role key here — the VPS agents have
 * their own scoped key so we can rotate/revoke one without nuking all of them.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticateAgentRequest } from '@/lib/api-auth'

function service() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const VALID_CATEGORIES = new Set([
  // Customer-facing (original 15)
  'message_handled',
  'enquiry_qualified',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'quote_sent',
  'quote_chased',
  'follow_up_sent',
  'review_requested',
  'review_collected',
  'escalation_to_owner',
  'emergency_handled',
  'research_performed',
  'report_delivered',
  'admin_task',
  // Trades-ops (added with the trades_ops_foundation migration)
  'job_captured',
  'variation_logged',
  'product_sourced',
  'pipeline_reviewed',
  'parts_prepared',
  'estimate_drafted',
  'estimate_delivered',
  'margin_reconciled',
])

type Payload = {
  category: string
  summary?: string
  contact_phone?: string
  contact_name?: string
  value_gbp?: number
  minutes_saved?: number
  related_table?: string
  related_id?: string
  meta?: Record<string, unknown>
  occurred_at?: string
  skill_used?: string
  outcome_tag?: string
}

export async function POST(req: NextRequest) {
  // 2026-05-12 (security audit C2) — use the central authenticateAgentRequest
  // helper from lib/api-auth.ts so this endpoint participates in the 3-tier
  // hash chain (current key → previous key during rotation window → legacy
  // plaintext with self-heal). Previous manual `.eq('agent_api_key', ...)`
  // lookup skipped the chain — leaked-key revocation lagged by the rotation
  // grace window. The helper accepts both `Authorization: Bearer` and
  // `x-api-key` headers (same shape as before).
  const auth = await authenticateAgentRequest(req)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const cfg = { client_id: auth.clientId }
  const supabase = service()

  let body: Payload
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.category || !VALID_CATEGORIES.has(body.category)) {
    return NextResponse.json({
      error: `category required, one of: ${[...VALID_CATEGORIES].join(', ')}`,
    }, { status: 400 })
  }

  const insert: Record<string, unknown> = {
    client_id: cfg.client_id,
    category: body.category,
    summary: body.summary ?? null,
    contact_phone: body.contact_phone ?? null,
    contact_name: body.contact_name ?? null,
    value_gbp: body.value_gbp ?? null,
    minutes_saved: body.minutes_saved ?? null,
    related_table: body.related_table ?? null,
    related_id: body.related_id ?? null,
    meta: body.meta ?? {},
    // Added with agent_autonomy_safety_rails migration — powers weekly-reflection
    // attribution and loop-observer detection. Required for L3 autonomy loop.
    skill_used: body.skill_used ?? null,
    outcome_tag: body.outcome_tag ?? null,
  }
  if (body.occurred_at) insert.occurred_at = body.occurred_at

  const { data, error } = await supabase
    .from('agent_actions')
    .insert(insert)
    .select('id, occurred_at')
    .single()

  if (error) {
    console.error('[log-action] insert failed:', error)
    return NextResponse.json({ error: 'Failed to log', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, id: data.id, occurred_at: data.occurred_at })
}
