import { NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/api-auth'
import { sendSms } from '@/lib/twilio'

export async function POST(request: Request) {
  // 2026-05-12 — Twilio no longer in use. Hard-gate before any auth or parse work.
  // sendSms also self-gates (defence in depth).
  if (process.env.TWILIO_ENABLED !== '1') {
    return NextResponse.json(
      { error: 'SMS is currently disabled' },
      { status: 410 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { to, message, contact_id } = body as { to?: string; message?: string; contact_id?: string }

  if (!to || !message) {
    return NextResponse.json({ error: 'to and message required' }, { status: 400 })
  }
  // Basic phone validation — must be digits with optional + prefix, 7-15 chars
  const cleanPhone = (to as string).replace(/[\s()-]/g, '')
  if (!/^\+?\d{7,15}$/.test(cleanPhone)) {
    return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 })
  }

  if (message.length > 1600) {
    return NextResponse.json({ error: 'Message too long (max 1600 chars)' }, { status: 400 })
  }

  const auth = await authenticateAgentRequest(request, body.client_id as string | undefined)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const result = await sendSms(to, message, auth.clientId, contact_id)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ success: true, messageId: result.messageId })
}
