import type { ApiRequest, ApiResponse } from "./_lib/server.js";
import { db, json, requireUser, subscriptionActive } from "./_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const [botResult, sub, visitorResult, conversationResult, unreadResult, replyResult] = await Promise.all([
      db.query("SELECT id, username, display_name, status, connected_at, created_at FROM bots WHERE owner_id=$1 LIMIT 1", [user.id]),
      subscriptionActive(user.id),
      db.query("SELECT count(*)::int AS count FROM bot_visitors v JOIN bots b ON b.id=v.bot_id WHERE b.owner_id=$1", [user.id]),
      db.query("SELECT count(*)::int AS count FROM conversations c JOIN bots b ON b.id=c.bot_id WHERE b.owner_id=$1 AND c.status='open'", [user.id]),
      db.query("SELECT COALESCE(sum(c.unread_count),0)::int AS count FROM conversations c JOIN bots b ON b.id=c.bot_id WHERE b.owner_id=$1", [user.id]),
      db.query("SELECT count(*)::int AS count FROM auto_replies a JOIN bots b ON b.id=a.bot_id WHERE b.owner_id=$1 AND a.is_enabled=true", [user.id]),
    ]);
    return json(res, 200, {
      bot: botResult.rows[0] ?? null,
      visitors: visitorResult.rows[0].count,
      openConversations: conversationResult.rows[0].count,
      unreadMessages: unreadResult.rows[0].count,
      activeAutoReplies: replyResult.rows[0].count,
      subscription: sub ? { active: true, expiresAt: sub.expires_at } : { active: false, expiresAt: null },
    });
  } catch (error) {
    console.error("dashboard_api_error", error);
    return json(res, 500, { error: "دریافت اطلاعات داشبورد ناموفق بود." });
  }
}
