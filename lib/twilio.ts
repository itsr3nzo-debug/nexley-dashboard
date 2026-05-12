/** Twilio SMS helper — sends SMS and logs to comms_log */

import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'
import { normalizePhone } from '@/lib/phone'

/**
 * Validate a Twilio webhook request via the `X-Twilio-Signature` header.
 *
 * Twilio's algorithm (TwiML webhook security):
 *   1. Take the full request URL the webhook hit (including query string).
 *   2. Append every form-POST parameter, sorted alphabetically by key,
 *      concatenated as `${key}${value}` with no separators.
 *   3. HMAC-SHA1 the result with the account's auth token.
 *   4. Base64-encode and compare timing-safely against `X-Twilio-Signature`.
 *
 * Returns true iff the signature matches. Never throws.
 *
 * Added 2026-05-12 (security audit C1). The previous shared-secret string-
 * compare on `x-twilio-webhook-secret` was non-standard and weaker than
 * Twilio's intended HMAC mechanism. Dual-accept rollout: routes check this
 * first, fall back to the shared-secret with a deprecation warn for 72h,
 * then drop the fallback once the legacy-warn log is clean.
 */
export function validateTwilioSignature(
  authToken: string,
  signatureHeader: string | null,
  fullUrl: string,
  formParams: Record<string, string>,
): boolean {
  try {
    if (!authToken || !signatureHeader) return false
    const sortedKeys = Object.keys(formParams).sort()
    const data = fullUrl + sortedKeys.map((k) => `${k}${formParams[k]}`).join('')
    const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
    if (expected.length !== signatureHeader.length) return false
    // Timing-safe compare — avoids leaking bytes via early-exit string match.
    let mismatch = 0
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i)
    }
    return mismatch === 0
  } catch {
    return false
  }
}

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER!
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function sendSms(
  to: string,
  body: string,
  clientId: string,
  contactId?: string | null
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // 2026-05-12 — Twilio is no longer in use. Gate behind explicit opt-in so the
  // path stays revertable for ~7 days, then deletes in a follow-up PR.
  // Default OFF — any caller that needs to keep working must set TWILIO_ENABLED=1.
  if (process.env.TWILIO_ENABLED !== '1') {
    return { success: false, error: 'Twilio disabled (TWILIO_ENABLED!=1)' }
  }

  const normalizedTo = normalizePhone(to)
  if (!normalizedTo) return { success: false, error: 'Invalid phone number' }

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  try {
    // Send via Twilio REST API
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64')
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: normalizedTo,
          From: TWILIO_FROM,
          Body: body,
        }),
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('Twilio SMS error:', data)
      return { success: false, error: data.message ?? 'SMS send failed' }
    }

    // Log to comms_log (best-effort, non-fatal)
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await supabase.from('comms_log').insert({
        client_id: clientId,
        contact_id: contactId ?? null,
        channel: 'sms',
        direction: 'outbound',
        body,
        status: 'sent',
        provider: 'twilio',
        external_id: data.sid,
      })
    } catch (logErr) {
      console.error('Failed to log SMS to comms_log:', logErr)
    }

    return { success: true, messageId: data.sid }
  } catch (e) {
    console.error('SMS send exception:', e)
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
}
