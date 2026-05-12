import { NextRequest, NextResponse } from "next/server";
import {
  getAgentConfigByPhone,
  getOrCreateContact,
} from "@/lib/conversation";
import { getSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio";

// Save-only webhook: stores inbound SMS to Supabase for async processing.
// The Mac Mini sms-responder (Claude Code on Max plan) handles AI replies.

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // 2026-05-12 — Twilio no longer in use. Gate behind explicit opt-in so a
  // leaked secret can't forge inbounds. Re-enable with TWILIO_ENABLED=1.
  if (process.env.TWILIO_ENABLED !== '1') {
    console.warn('[sms-webhook] disabled (TWILIO_ENABLED!=1) — returning 410');
    return new Response('<Response></Response>', {
      status: 410,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // 2026-05-12 (security audit C1+M3) — Twilio HMAC-SHA1 signature, the
  // standard TwiML webhook validation mechanism. Dual-accept window:
  // TWILIO_HMAC_DUAL_ACCEPT=1 → fall back to legacy shared-secret with warn
  // (72h soak), then unset to enforce HMAC only.
  const formData = await req.formData();
  const formParams: Record<string, string> = {};
  formData.forEach((v, k) => {
    if (typeof v === "string") formParams[k] = v;
  });

  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioSignature = req.headers.get("x-twilio-signature");
  const fullUrl = new URL(req.url).toString();
  const hmacOk = !!twilioAuthToken && validateTwilioSignature(
    twilioAuthToken,
    twilioSignature,
    fullUrl,
    formParams,
  );

  if (!hmacOk) {
    const dualAccept = process.env.TWILIO_HMAC_DUAL_ACCEPT === "1";
    const legacySecret = process.env.TWILIO_WEBHOOK_SECRET;
    const provided = req.headers.get("x-twilio-webhook-secret");
    if (dualAccept && legacySecret && provided === legacySecret) {
      console.warn(
        "[sms-webhook][twilio-auth] legacy shared-secret used — migrate to X-Twilio-Signature HMAC (will be removed after 72h clean)",
      );
    } else if (!twilioAuthToken) {
      console.error("[sms-webhook] TWILIO_AUTH_TOKEN not configured — cannot validate HMAC");
      return new Response("<Response></Response>", {
        status: 500,
        headers: { "Content-Type": "text/xml" },
      });
    } else {
      console.error(
        "[sms-webhook] HMAC validation failed — rejecting (sig-present=" +
          !!twilioSignature + ", dual-accept=" + dualAccept + ")",
      );
      return new Response("<Response></Response>", {
        status: 403,
        headers: { "Content-Type": "text/xml" },
      });
    }
  }

  try {
    const from = (formData.get("From") as string) || "";
    const to = (formData.get("To") as string) || "";
    const body = (formData.get("Body") as string) || "";
    const messageSid = (formData.get("MessageSid") as string) || "";

    console.log(
      `[sms-webhook] Message from ${from} to ${to}: "${body.substring(0, 50)}..."`
    );

    if (!body.trim()) {
      // Return empty TwiML for blank messages
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Lookup which client owns this phone number
    const agentData = await getAgentConfigByPhone(to);
    if (!agentData) {
      console.log(`[sms-webhook] No agent_config found for ${to}`);
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const { client_id } = agentData;

    // Get or create the customer contact
    const contact = await getOrCreateContact(client_id, from);

    // Insert inbound message with pending_response status
    // Mac Mini sms-responder.sh polls for these and generates AI replies via Claude Code (Max plan)
    const supabase = getSupabase();
    await supabase.from("comms_log").insert({
      client_id,
      contact_id: contact.id,
      channel: "sms",
      direction: "inbound",
      from_number: from,
      to_number: to,
      body,
      status: "pending_response",
      provider: "twilio",
      external_id: messageSid,
      sent_at: new Date().toISOString(),
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `[sms-webhook] Saved in ${elapsed}ms — contact: ${contact.id}, awaiting Mac Mini response`
    );

    // Return empty TwiML — response comes async from Mac Mini
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("[sms-webhook] Error:", error);
    // Always return valid TwiML so Twilio doesn't retry
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
