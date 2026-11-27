import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, decryptToken, json, safeEqualHex, sha256, subscriptionActive, telegram } from "../_lib/server.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string };
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const rawId = req.query.botId;
  const botId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!botId) return json(res, 400, { error: "Missing bot id" });
  try {
    const botResult = await db.query(
      "SELECT b.id,b.owner_id,b.status,b.webhook_secret_hash,s.encrypted_token FROM bots b JOIN bot_secrets s ON s.bot_id=b.id WHERE b.id=$1 LIMIT 1",
      [botId],
    );
    const bot = botResult.rows[0];
    if (!bot || bot.status !== "active") return json(res, 200, { ok: true });
    const supplied = req.headers["x-telegram-bot-api-secret-token"];
    const secret = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!secret || !safeEqualHex(sha256(secret), bot.webhook_secret_hash)) return json(res, 403, { error: "Forbidden" });

    const update = (req.body && typeof req.body === "object" ? req.body : {}) as TgUpdate;
    if (!Number.isSafeInteger(update.update_id)) return json(res, 400, { error: "Invalid update" });
    const inserted = await db.query(
      "INSERT INTO telegram_updates (bot_id,update_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING update_id",
      [bot.id, update.update_id],
    );
    if (!inserted.rowCount) return json(res, 200, { ok: true, duplicate: true });

    const message = update.message;
    const sender = message?.from;
    if (!message || !sender || message.chat.type !== "private" || sender.is_bot) return json(res, 200, { ok: true });

    const text = (message.text ?? "").slice(0, 4096);
    const client = await db.connect();
    let visitorId: string;
    let conversationId: string;
    try {
      await client.query("BEGIN");
      const visitor = await client.query(
        `INSERT INTO bot_visitors (bot_id,telegram_user_id,chat_id,username,first_name,last_name,language_code,is_bot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false)
         ON CONFLICT (bot_id,telegram_user_id) DO UPDATE SET
           chat_id=EXCLUDED.chat_id, username=EXCLUDED.username, first_name=EXCLUDED.first_name,
           last_name=EXCLUDED.last_name, language_code=EXCLUDED.language_code,last_seen_at=now()
         RETURNING id`,
        [bot.id, sender.id, message.chat.id, sender.username ?? null, sender.first_name ?? null, sender.last_name ?? null, sender.language_code ?? null],
      );
      visitorId = visitor.rows[0].id;
      const conversation = await client.query(
        `INSERT INTO conversations (bot_id,visitor_id,last_message_at)
         VALUES ($1,$2,now()) ON CONFLICT (bot_id,visitor_id) DO UPDATE SET
         status='open',last_message_at=now(),updated_at=now() RETURNING id`,
        [bot.id, visitorId],
      );
      conversationId = conversation.rows[0].id;
      await client.query(
        `INSERT INTO messages (conversation_id,telegram_message_id,direction,sender_type,text_body,telegram_payload,delivery_status,sent_at)
         VALUES ($1,$2,'inbound','visitor',$3,$4::jsonb,'received',now())`,
        [conversationId, message.message_id, text || null, JSON.stringify(message)],
      );
      await client.query("UPDATE conversations SET unread_count=unread_count+1 WHERE id=$1", [conversationId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const subscription = await subscriptionActive(bot.owner_id);
    if (!subscription) return json(res, 200, { ok: true, stored: true, subscriptionInactive: true });
    if (text.startsWith("/start")) {
      await telegram(decryptToken(bot.encrypted_token), "sendMessage", {
        chat_id: message.chat.id,
        text: "سلام! پیام شما دریافت شد. به‌زودی پاسخ‌گوی شما خواهیم بود.",
      });
      return json(res, 200, { ok: true, stored: true });
    }
    if (text) {
      const rules = await db.query(
        "SELECT trigger_text,reply_text,match_type FROM auto_replies WHERE bot_id=$1 AND is_enabled=true ORDER BY created_at ASC",
        [bot.id],
      );
      const normalized = text.toLocaleLowerCase("fa");
      const match = rules.rows.find((rule: { trigger_text: string; match_type: string }) => {
        const trigger = rule.trigger_text.toLocaleLowerCase("fa");
        if (rule.match_type === "exact") return normalized === trigger;
        if (rule.match_type === "starts_with") return normalized.startsWith(trigger);
        return normalized.includes(trigger);
      });
      if (match) {
        const sent = await telegram<{ message_id: number }>(decryptToken(bot.encrypted_token), "sendMessage", { chat_id: message.chat.id, text: match.reply_text });
        await db.query(
          "INSERT INTO messages (conversation_id,telegram_message_id,direction,sender_type,text_body,delivery_status,sent_at) VALUES ($1,$2,'outbound','system',$3,'sent',now())",
          [conversationId, sent.message_id, match.reply_text],
        );
      }
    }
    return json(res, 200, { ok: true, stored: true });
  } catch (error) {
    console.error("telegram_webhook_error", error);
    return json(res, 500, { error: "Webhook processing failed" });
  }
}
