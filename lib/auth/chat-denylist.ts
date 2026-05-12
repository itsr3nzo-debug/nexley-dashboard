/**
 * Hardcoded denylist for dashboard chat access.
 *
 * `supabase.auth.getUser()` SHOULD already reject users with `banned_until`
 * in the future, but client-cached JWTs can survive briefly. This module is
 * defence-in-depth: every chat-related route consults `isChatBlocked()`
 * right after the auth check, and any user_id in the set is rejected
 * regardless of token validity.
 *
 * To unblock: remove the user_id from CHAT_DENYLIST and redeploy.
 * To add: append the user_id + a short reason + a timestamp.
 *
 * If this grows beyond ~5 entries, migrate to a Supabase table
 * (auth.chat_denylist or similar) so changes don't require a deploy.
 */

const CHAT_DENYLIST: ReadonlySet<string> = new Set([
  // 2026-05-11 — Renzo instruction. Murtaza, slug `murtaza`, trial.
  // Also banned at auth.users level (banned_until = 2099-01-01).
  // Backstop: even if his JWT survives auth checks briefly, this denylist
  // refuses any /api/chat/* request server-side.
  '692e4f4b-d7a8-4134-8100-427e3b49f11d',
])

export function isChatBlocked(userId: string | null | undefined): boolean {
  if (!userId) return false
  return CHAT_DENYLIST.has(userId)
}
