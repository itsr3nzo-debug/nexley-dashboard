import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // 2026-05-12 — Twilio no longer in use. Hard-gate before any auth work.
  if (process.env.TWILIO_ENABLED !== '1') {
    return NextResponse.json(
      { error: 'SMS is currently disabled' },
      { status: 410 },
    )
  }

  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const clientId = user.app_metadata?.client_id
  if (!clientId) {
    return NextResponse.json({ error: 'No client linked' }, { status: 403 })
  }

  // Parse body
  let to: string
  let body: string
  try {
    const json = await req.json()
    to = (json.to ?? '').trim()
    body = (json.body ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!to || !body) {
    return NextResponse.json({ error: 'to and body are required' }, { status: 400 })
  }

  if (body.length > 1600) {
    return NextResponse.json({ error: 'Message too long (max 1600 chars)' }, { status: 400 })
  }

  // Env vars
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  if (!accountSid || !authToken || !from) {
    return NextResponse.json({ error: 'SMS not configured' }, { status: 503 })
  }

  // Send via Twilio REST API (no npm package — pure fetch)
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const params = new URLSearchParams({ From: from, To: to, Body: body })

  const twilioRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!twilioRes.ok) {
    const errData = await twilioRes.json().catch(() => ({}))
    const msg = (errData as { message?: string }).message ?? 'Twilio error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const smsData = await twilioRes.json() as { sid: string; status: string }

  // Log to comms_log (best-effort — don't fail if table missing)
  try {
    await supabase.from('comms_log').insert({
      client_id: clientId,
      channel: 'sms',
      direction: 'outbound',
      body,
      status: smsData.status === 'queued' || smsData.status === 'sent' ? 'sent' : 'queued',
      provider: 'twilio',
      external_id: smsData.sid,
      sent_at: new Date().toISOString(),
      metadata: { to, from },
    })
  } catch {
    // Non-fatal — SMS was sent even if logging fails
  }

  return NextResponse.json({ success: true, sid: smsData.sid })
}
