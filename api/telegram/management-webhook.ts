import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, json, sha256, telegram } from "../_lib/server.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TgMessage = { chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgUpdate = { update_id: number; message?: TgMessage };

function configuredAdminIds() {
  return new Set((process.env.PLATFORM_SUPERADMIN_TELEGRAM_IDS ?? "")
    .split(",").map((value) => value.trim()).filter((value) => /^\d+$/.test(value)));
}

async function send(token: string, chatId: number, text: string) {
  await telegram(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const token = process.env.MANAGEMENT_BOT_TOKEN;
  const webhookSecret = process.env.MANAGEMENT_BOT_WEBHOOK_SECRET;
  if (!token || !webhookSecret) return json(res, 503, { error: "Management bot is not configured" });
  const suppliedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (typeof suppliedSecret !== "string" || suppliedSecret.length !== webhookSecret.length ||
      !Buffer.from(suppliedSecret).equals(Buffer.from(webhookSecret))) {
    return json(res, 401, { error: "Unauthorized webhook" });
  }

  const update = (req.body && typeof req.body === "object" ? req.body : {}) as TgUpdate;
  const message = update.message;
  const from = message?.from;
  const chatId = message?.chat?.id;
  if (!message || !from || !chatId || message.chat.type !== "private" || from.is_bot) {
    return json(res, 200, { ok: true });
  }

  try {
    const telegramId = String(from.id);
    const text = (message.text ?? "").trim();
    const startMatch = text.match(/^\/start(?:\s+([A-Za-z0-9_-]{16,64}))?/);
    const admin = configuredAdminIds().has(telegramId);

    if (startMatch?.[1]) {
      const challengeHash = sha256(startMatch[1]);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const challenge = await client.query(
          `SELECT id,user_id FROM telegram_link_challenges
            WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()
            FOR UPDATE`,
          [challengeHash],
        );
        if (challenge.rowCount) {
          await client.query(
            `INSERT INTO customer_telegram_accounts (user_id,telegram_user_id,telegram_username,last_seen_at)
             VALUES ($1,$2,$3,now())
             ON CONFLICT (telegram_user_id) DO UPDATE SET user_id=EXCLUDED.user_id,
               telegram_username=EXCLUDED.telegram_username,last_seen_at=now(),updated_at=now()`,
            [challenge.rows[0].user_id, telegramId, from.username ?? null],
          );
          await client.query("UPDATE telegram_link_challenges SET consumed_at=now() WHERE id=$1", [challenge.rows[0].id]);
          await client.query("COMMIT");
          await send(token, chatId, "اتصال حساب تلگرام با موفقیت تأیید شد. از این پس می‌توانی وضعیت حساب و ربات‌های خودت را از همین ربات مدیریت کنی.\n\n/status - وضعیت لایسنس\n/bots - فهرست ربات‌ها");
          return json(res, 200, { ok: true });
        }
        await client.query("ROLLBACK");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await send(token, chatId, "این لینک اتصال نامعتبر، منقضی یا قبلاً استفاده شده است. از پنل کاربری یک لینک تازه بساز.");
      return json(res, 200, { ok: true });
    }

    if (admin) {
      if (text === "/start" || text === "/admin") {
        await send(token, chatId, "پنل مدیر کل پلتفرم\n\nاین حساب در فهرست مدیران کل امن ثبت شده است.\n/customers - تعداد مشتریان\n/licenses - لایسنس‌های نزدیک به انقضا");
      } else if (text === "/customers") {
        const result = await db.query(`SELECT count(*)::int AS total FROM "user" WHERE role<>'super_admin'`);
        await send(token, chatId, `تعداد حساب‌های مشتری: ${result.rows[0].total}`);
      } else if (text === "/licenses") {
        const result = await db.query(
          `SELECT count(*)::int AS total FROM licenses
            WHERE status='active' AND expires_at>now() AND expires_at<=now()+interval '30 days'`,
        );
        await send(token, chatId, `لایسنس فعال با انقضای ۳۰ روز آینده: ${result.rows[0].total}`);
      } else {
        await send(token, chatId, "دستور نامعتبر است. /admin را بفرست.");
      }
      return json(res, 200, { ok: true });
    }

    const account = await db.query(
      `SELECT u.id,u.name,u.email FROM customer_telegram_accounts a
        JOIN "user" u ON u.id=a.user_id WHERE a.telegram_user_id=$1 LIMIT 1`,
      [telegramId],
    );
    if (!account.rowCount) {
      await send(token, chatId, "برای استفاده از مدیریت تلگرامی، ابتدا وارد پنل تلگرام‌یار شو و حساب تلگرامت را با لینک یک‌بارمصرف متصل کن.");
      return json(res, 200, { ok: true });
    }

    if (text === "/start" || text === "/help") {
      await send(token, chatId, `سلام ${account.rows[0].name}، به مدیریت تلگرام‌یار خوش آمدی.\n\n/status - وضعیت لایسنس\n/bots - ربات‌های حساب تو\n/help - راهنما`);
    } else if (text === "/status") {
      const result = await db.query(
        `SELECT status,starts_at,expires_at FROM licenses
          WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [account.rows[0].id],
      );
      const license = result.rows[0];
      if (!license) await send(token, chatId, "برای این حساب هنوز لایسنسی صادر نشده است.");
      else await send(token, chatId, `وضعیت لایسنس: ${license.status}\nشروع: ${license.starts_at ? new Date(license.starts_at).toLocaleDateString("fa-IR") : "—"}\nانقضا: ${license.expires_at ? new Date(license.expires_at).toLocaleDateString("fa-IR") : "—"}`);
    } else if (text === "/bots") {
      const result = await db.query(
        "SELECT name,username,status FROM bots WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",
        [account.rows[0].id],
      );
      const lines = result.rows.map((bot: {name:string;username:string|null;status:string}) =>
        `• ${bot.name}${bot.username ? " (@" + bot.username + ")" : ""} — ${bot.status}`);
      await send(token, chatId, lines.length ? "ربات‌های متعلق به حساب تو:\n" + lines.join("\n") : "هنوز رباتی برای این حساب ثبت نشده است.");
    } else {
      await send(token, chatId, "دستور نامعتبر است. /help را بفرست.");
    }
    await db.query("UPDATE customer_telegram_accounts SET last_seen_at=now(),telegram_username=$2,updated_at=now() WHERE telegram_user_id=$1", [telegramId, from.username ?? null]);
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("management_telegram_webhook_error", error);
    return json(res, 200, { ok: true });
  }
}
