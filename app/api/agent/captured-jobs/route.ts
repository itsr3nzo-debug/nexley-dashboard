/**
 * POST /api/agent/captured-jobs
 *
 * Agent skill `capture-job-note` posts raw captures here. Dashboard-side
 * reviewer (or auto-pusher when Fergus creds exist) pushes to the job system.
 *
 * Auth: agent bearer key (oak_...) — same shape as /api/agent/log-action.
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

type Payload = {
  source_type: 'voice_note' | 'text' | 'photo' | 'whatsapp_forward' | 'email'
  raw_transcript?: string
  attachment_urls?: string[]
  extracted_client_name?: string
  extracted_client_phone?: string
  extracted_address?: string
  extracted_action?: string
  extracted_due?: string
  extracted_due_date?: string
  extracted_parts?: Array<{ item: string; qty: number }>
  extracted_cost_gbp?: number
  meta?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  // 2026-05-12 (security audit C2) — use authenticateAgentRequest for hash-
  // chain lookup (current → previous → legacy plaintext with self-heal).
  // See log-action/route.ts for rationale.
  const auth = await authenticateAgentRequest(req)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const cfg = { client_id: auth.clientId }
  const supabase = service()

  let body: Payload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.source_type) {
    return NextResponse.json({ error: 'source_type required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('captured_jobs')
    .insert({
      client_id: cfg.client_id,
      source_type: body.source_type,
      raw_transcript: body.raw_transcript ?? null,
      attachment_urls: body.attachment_urls ?? [],
      extracted_client_name: body.extracted_client_name ?? null,
      extracted_client_phone: body.extracted_client_phone ?? null,
      extracted_address: body.extracted_address ?? null,
      extracted_action: body.extracted_action ?? null,
      extracted_due: body.extracted_due ?? null,
      extracted_due_date: body.extracted_due_date ?? null,
      extracted_parts: body.extracted_parts ?? [],
      extracted_cost_gbp: body.extracted_cost_gbp ?? null,
      meta: body.meta ?? {},
    })
    .select('id, captured_at, status')
    .single()

  if (error) return NextResponse.json({ error: 'Insert failed', detail: error.message }, { status: 500 })
  return NextResponse.json({ success: true, ...data })
}
