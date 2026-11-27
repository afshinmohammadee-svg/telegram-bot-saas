import type { ApiRequest, ApiResponse } from "./_lib/server.js";
import { db, json, requireUser } from "./_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const result = await db.query(
      `SELECT v.id,v.telegram_user_id,v.username,v.first_name,v.last_name,v.language_code,v.first_seen_at,v.last_seen_at,
              (SELECT count(*)::int FROM conversations c WHERE c.bot_id=v.bot_id AND c.visitor_id=v.id) AS conversations
         FROM bot_visitors v JOIN bots b ON b.id=v.bot_id
        WHERE b.owner_id=$1 ORDER BY v.last_seen_at DESC LIMIT 200`,
      [user.id],
    );
    return json(res, 200, { visitors: result.rows });
  } catch (error) {
    console.error("visitors_api_error", error);
    return json(res, 500, { error: "دریافت بازدیدکنندگان ناموفق بود." });
  }
}
