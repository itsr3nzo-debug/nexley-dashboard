import { NextRequest } from "next/server";
import {
  getAgentConfigByPhone,
  getOrCreateContact,
} from "@/lib/conversation";
import { getSupabase } from "@/lib/supabase";
import { validateTwilioSignature } from "@/lib/twilio";

// Save-only webhook: stores inbound WhatsApp to Supabase for async processing.
// The Mac Mini responder (Claude Code on Max plan) handles AI replies.
// Identical pattern to SMS webhook — Twilio WhatsApp uses the same format.

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // 2026-05-12 — Twilio no longer in use. Gate the whole route behind explicit
  // opt-in so leaked secrets can't be used to forge inbounds into Supabase.
  // 410 Gone (rather than 404) so anyone with old documentation sees a clear
  // "this endpoint is permanently disabled" signal. Re-enable by setting
  // TWILIO_ENABLED=1 in Vercel env (the dual-accept HMAC hardening below is
  // preserved for that case).
  if (process.env.TWILIO_ENABLED !== '1') {
    console.warn('[whatsapp-webhook] disabled (TWILIO_ENABLED!=1) — returning 410');
    return new Response('<Response></Response>', {
      status: 410,
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // 2026-05-12 (security audit C1+M3) — Twilio HMAC-SHA1 signature validation,
  // the standard TwiML webhook mechanism. Replaces the previous plain shared-
  // secret compare on `x-twilio-webhook-secret`. Dual-accept window: set
  // TWILIO_HMAC_DUAL_ACCEPT=1 to fall back to the legacy shared-secret with
  // a deprecation warn (72h soak intended). Unset to enforce HMAC only.
  //
  // INTERNAL_API_KEY fallback removed — it was a deprecated bridge and made
  // a leaked INTERNAL_API_KEY enough to forge Twilio inbounds.
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
        "[whatsapp-webhook][twilio-auth] legacy shared-secret used — migrate to X-Twilio-Signature HMAC (will be removed after 72h clean)",
      );
    } else if (!twilioAuthToken) {
      console.error("[whatsapp-webhook] TWILIO_AUTH_TOKEN not configured — cannot validate HMAC");
      return new Response("<Response></Response>", {
        status: 500,
        headers: { "Content-Type": "text/xml" },
      });
    } else {
      console.error(
        "[whatsapp-webhook] HMAC validation failed — rejecting (sig-present=" +
          !!twilioSignature + ", dual-accept=" + dualAccept + ")",
      );
      return new Response("<Response></Response>", {
        status: 403,
        headers: { "Content-Type": "text/xml" },
      });
    }
  }

  try {
    // Strip "whatsapp:" prefix from phone numbers
    const from = ((formData.get("From") as string) || "").replace("whatsapp:", "");
    const to = ((formData.get("To") as string) || "").replace("whatsapp:", "");
    const body = (formData.get("Body") as string) || "";
    const messageSid = (formData.get("MessageSid") as string) || "";
    const profileName = (formData.get("ProfileName") as string) || "";

    console.log(
      `[whatsapp-webhook] Message from ${from} to ${to}: "${body.substring(0, 50)}..."`
    );

    if (!body.trim()) {
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    // Lookup which client owns this phone number
    const agentData = await getAgentConfigByPhone(to);
    if (!agentData) {
      console.log(`[whatsapp-webhook] No agent_config found for ${to}`);
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    }

    const { client_id } = agentData;

    // Get or create the customer contact
    const contact = await getOrCreateContact(client_id, from, profileName || undefined);

    // Insert inbound message with pending_response status
    // Mac Mini responder polls for these and generates AI replies via Claude Code (Max plan)
    const supabase = getSupabase();
    await supabase.from("comms_log").insert({
      client_id,
      contact_id: contact.id,
      channel: "whatsapp",
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
      `[whatsapp-webhook] Saved in ${elapsed}ms — contact: ${contact.id}, awaiting Mac Mini response`
    );

    // Return empty TwiML — response comes async from Mac Mini
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    console.error("[whatsapp-webhook] Error:", error);
    return new Response("<Response></Response>", {
      headers: { "Content-Type": "text/xml" },
    });
  }
}
