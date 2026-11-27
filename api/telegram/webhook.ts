import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, decryptToken, json, safeEqualHex, sha256, subscriptionActive, telegram } from "../_lib/server.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string };
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgCallback = { id: string; data?: string; from: TgUser; message?: TgMessage };
type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallback };

async function showMenu(token: string, botId: string, chatId: number, parentId: string | null) {
  const result = await db.query(
    `SELECT id,title,description,parent_id,response_type,response_content,target_url
       FROM bot_menus WHERE bot_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND is_active=true
      ORDER BY sort_order,title LIMIT 100`,
    [botId,parentId],
  );
  const rows = result.rows as Array<{id:string;title:string;description:string|null;parent_id:string|null;response_type:string;response_content:string|null;target_url:string|null}>;
  const keyboard = rows.map(item => [{
    text: item.title.slice(0,64),
    ...(item.response_type === "url" && item.target_url
      ? { url: item.target_url }
      : { callback_data: "menu:" + item.id }),
  }]);
  if (parentId) {
    const parent = await db.query("SELECT parent_id FROM bot_menus WHERE id=$1 AND bot_id=$2", [parentId,botId]);
    keyboard.push([{ text: "⬅️ بازگشت", callback_data: "back:" + (parent.rows[0]?.parent_id ?? "root") }]);
  }
  if (!keyboard.length) {
    await telegram(token,"sendMessage",{chat_id:chatId,text:"هنوز منویی برای نمایش تعریف نشده است."});
    return;
  }
  await telegram(token,"sendMessage",{
    chat_id:chatId,
    text: parentId ? "یکی از گزینه‌ها را انتخاب کن:" : "سلام! لطفاً یکی از گزینه‌ها را انتخاب کن:",
    reply_markup:{inline_keyboard:keyboard},
  });
}

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

    const callback = update.callback_query;
    if (callback) {
      const callbackChatId = callback.message?.chat.id;
      const callbackData = callback.data ?? "";
      const subscription = await subscriptionActive(bot.owner_id);
      if (callbackChatId && subscription) {
        const token = decryptToken(bot.encrypted_token);
        if (callbackData.startsWith("menu:")) {
          const menuId = callbackData.slice(5);
          const selected = await db.query(
            "SELECT id,title,description,parent_id,response_type,response_content,target_url FROM bot_menus WHERE id=$1 AND bot_id=$2 AND is_active=true",
            [menuId,bot.id],
          );
          const item = selected.rows[0];
          if (item) {
            if (item.response_type === "submenu") {
              await showMenu(token,bot.id,callbackChatId,item.id);
            } else {
              const content = String(item.response_content ?? item.description ?? item.title);
              const siblings = await db.query(
                "SELECT id,title,response_type,target_url FROM bot_menus WHERE bot_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND is_active=true ORDER BY sort_order,title",
                [bot.id,item.parent_id],
              );
              const keyboard = siblings.rows.map((entry: {id:string;title:string;response_type:string;target_url:string|null})=>[{
                text:entry.title.slice(0,64),
                ...(entry.response_type==="url" && entry.target_url ? {url:entry.target_url}:{callback_data:"menu:"+entry.id}),
              }]);
              if (item.parent_id) {
                const parentInfo = await db.query("SELECT parent_id FROM bot_menus WHERE id=$1 AND bot_id=$2", [item.parent_id,bot.id]);
                keyboard.push([{text:"⬅️ بازگشت",callback_data:"back:"+(parentInfo.rows[0]?.parent_id ?? "root")}]);
              }
              const replyMarkup = keyboard.length ? {reply_markup:{inline_keyboard:keyboard}} : {};
              if (item.response_type === "photo") {
                await telegram(token,"sendPhoto",{chat_id:callbackChatId,photo:content,...replyMarkup});
              } else if (item.response_type === "document") {
                await telegram(token,"sendDocument",{chat_id:callbackChatId,document:content,...replyMarkup});
              } else {
                await telegram(token,"sendMessage",{chat_id:callbackChatId,text:content,...replyMarkup});
              }
            }
          }
        } else if (callbackData.startsWith("back:")) {
          const parent = callbackData.slice(5);
          await showMenu(token,bot.id,callbackChatId,parent==="root"?null:parent);
        }
      }
      await telegram(decryptToken(bot.encrypted_token),"answerCallbackQuery",{callback_query_id:callback.id});
      return json(res,200,{ok:true});
    }

    const message = update.message;
    const sender = message?.from;
    if (!message || !sender || message.chat.type !== "private" || sender.is_bot) return json(res, 200, { ok: true });

    const text = (message.text ?? "").slice(0, 4096);
    const accessResult = await db.query(
      `SELECT limits_snapshot FROM licenses
        WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now()
        ORDER BY expires_at DESC LIMIT 1`,
      [bot.owner_id],
    );
    const visitorLimit = accessResult.rows[0]?.limits_snapshot?.maxVisitors;
    if (Number.isInteger(visitorLimit) && visitorLimit >= 0) {
      const knownVisitor = await db.query(
        "SELECT 1 FROM bot_visitors WHERE bot_id=$1 AND telegram_user_id=$2 LIMIT 1",
        [bot.id,sender.id],
      );
      if (!knownVisitor.rowCount) {
        const visitorCount = await db.query("SELECT count(*)::int AS total FROM bot_visitors WHERE bot_id=$1", [bot.id]);
        if (visitorCount.rows[0].total >= visitorLimit) return json(res,200,{ok:true,visitorLimitReached:true});
      }
    }
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
      await showMenu(decryptToken(bot.encrypted_token),bot.id,message.chat.id,null);
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
