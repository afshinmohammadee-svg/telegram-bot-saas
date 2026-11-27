import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, json, requireUser } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const result = await db.query(
      `SELECT c.id,c.status,c.unread_count,c.last_message_at,
              v.username,v.first_name,v.last_name,v.telegram_user_id,
              (SELECT m.text_body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM conversations c JOIN bots b ON b.id=c.bot_id JOIN bot_visitors v ON v.id=c.visitor_id
        WHERE b.owner_id=$1 ORDER BY c.last_message_at DESC NULLS LAST LIMIT 100`,
      [user.id],
    );
    return json(res, 200, { conversations: result.rows });
  } catch (error) {
    console.error("conversations_api_error", error);
    return json(res, 500, { error: "دریافت گفتگوها ناموفق بود." });
  }
}
