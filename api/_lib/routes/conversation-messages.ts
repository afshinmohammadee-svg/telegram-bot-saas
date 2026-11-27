import type { ApiRequest, ApiResponse } from "../server.js";
import { bodyOf, db, decryptToken, json, requireUser, subscriptionActive, telegram } from "../server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const rawId = req.query.conversationId;
    const conversationId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!conversationId) return json(res, 400, { error: "شناسه گفتگو نامعتبر است." });
    const owned = await db.query(
      `SELECT c.id,c.bot_id,v.chat_id,b.owner_id,s.encrypted_token
         FROM conversations c JOIN bots b ON b.id=c.bot_id
         JOIN bot_visitors v ON v.id=c.visitor_id JOIN bot_secrets s ON s.bot_id=b.id
        WHERE c.id=$1 AND b.owner_id=$2 LIMIT 1`,
      [conversationId, user.id],
    );
    const row = owned.rows[0];
    if (!row) return json(res, 404, { error: "گفتگو پیدا نشد." });

    if (req.method === "GET") {
      const messages = await db.query(
        "SELECT id,direction,sender_type,text_body,delivery_status,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 200",
        [conversationId],
      );
      await db.query("UPDATE conversations SET unread_count=0 WHERE id=$1", [conversationId]);
      return json(res, 200, { messages: messages.rows });
    }
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    if (!await subscriptionActive(user.id)) return json(res, 403, { error: "اشتراک شما فعال نیست." });
    const text = String(bodyOf(req).text ?? "").trim();
    if (!text || text.length > 4096) return json(res, 400, { error: "متن پیام باید بین ۱ تا ۴۰۹۶ نویسه باشد." });
    const sent = await telegram<{ message_id: number }>(decryptToken(row.encrypted_token), "sendMessage", { chat_id: row.chat_id, text });
    await db.query(
      "INSERT INTO messages (conversation_id,telegram_message_id,direction,sender_type,text_body,delivery_status,sent_at) VALUES ($1,$2,'outbound','bot_owner',$3,'sent',now())",
      [conversationId, sent.message_id, text],
    );
    await db.query("UPDATE conversations SET last_message_at=now(),status='open',updated_at=now() WHERE id=$1", [conversationId]);
    return json(res, 201, { success: true });
  } catch (error) {
    console.error("conversation_messages_error", error);
    return json(res, 500, { error: "ارسال یا دریافت پیام ناموفق بود." });
  }
}
