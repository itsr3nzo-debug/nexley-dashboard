/**
 * POST /api/voice/token
 *
 * Mints a LiveKit room JWT for an admin voice session.
 *
 * Gating (defence in depth — the worker re-validates user_id too):
 *   1. Supabase session must exist (server-cookie auth).
 *   2. app_metadata.role must be 'super_admin'. Plain 'owner' is NOT enough.
 *   3. Email must be in VOICE_ADMIN_EMAILS allowlist. As of 2026-05-12 this
 *      is ONLY Lorenzo. Adding super_admin role alone is NOT sufficient —
 *      we explicitly enumerate which super_admins get voice access.
 *      (Defence-in-depth against accidental super_admin role grants.)
 *   4. user_id must not be in the chat denylist (defence against stale
 *      JWTs that haven't been banned yet).
 *
 * Returns: { token, url, room }.
 *
 * Room naming: `voice-${userId}` — one room per user. Multiple sessions from
 * the same user replace each other. Multiple users get different rooms.
 *
 * Token lifetime: 30 min. Long enough for a normal session; short enough that
 * a leaked token doesn't grant permanent access.
 */
import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";
import { isChatBlocked } from "@/lib/auth/chat-denylist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

const TOKEN_TTL_SECONDS = 30 * 60;

// Hard allowlist of emails permitted to use the admin voice channel.
// As of 2026-05-12, voice is gated to Lorenzo only. To add another admin,
// (1) add their email here, (2) add their Supabase user_id to
// VOICE_ALLOWED_USER_IDS in ~/.config/nexley/voice.env, (3) redeploy.
// Comparison is case-insensitive on the local part.
const VOICE_ADMIN_EMAILS: ReadonlySet<string> = new Set([
  "lorenzobandawe@gmail.com",
]);

// Rate-limit token mints to one per user every 30s.
// Module-level Map is per-instance on Vercel — multiple Lambda instances
// would let a few extra mints through, but for a single allowlisted user
// hitting the same warm instance this is sufficient. If we ever need
// global rate-limiting, move to Upstash Redis or a Supabase row with
// pg_advisory_lock — not worth the complexity at admin-only scale.
const TOKEN_MINT_COOLDOWN_MS = 30 * 1000;
const lastMintByUserId = new Map<string, number>();

function isRateLimited(userId: string): boolean {
  const last = lastMintByUserId.get(userId);
  const now = Date.now();
  if (last && now - last < TOKEN_MINT_COOLDOWN_MS) return true;
  lastMintByUserId.set(userId, now);
  return false;
}

export async function POST() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return NextResponse.json(
      { error: "voice channel not configured on this dashboard" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const role = (user.app_metadata?.role as string | undefined) ?? null;
  if (role !== "super_admin") {
    return NextResponse.json(
      { error: "voice channel is admin-only" },
      { status: 403 },
    );
  }

  const userEmail = (user.email ?? "").toLowerCase().trim();
  if (!VOICE_ADMIN_EMAILS.has(userEmail)) {
    // super_admin role alone is not enough — must be on the explicit allowlist.
    return NextResponse.json(
      { error: "voice channel not enabled for this account" },
      { status: 403 },
    );
  }

  if (isChatBlocked(user.id)) {
    return NextResponse.json({ error: "blocked" }, { status: 403 });
  }

  if (isRateLimited(user.id)) {
    return NextResponse.json(
      { error: "too many requests — wait 30 seconds" },
      { status: 429, headers: { "Retry-After": "30" } },
    );
  }

  const userName =
    (user.user_metadata?.full_name as string | undefined) ||
    user.email?.split("@")[0] ||
    "owner";

  const room = `voice-${user.id}`;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: user.id,
    name: userName,
    ttl: TOKEN_TTL_SECONDS,
    // Worker reads this on participant connect; allowlist is enforced server-side.
    metadata: JSON.stringify({
      user_id: user.id,
      user_name: userName,
      role,
    }),
  });

  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({
    token,
    url: LIVEKIT_URL,
    room,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
}
