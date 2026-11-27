import menuHandler from "../_lib/bot-menus.js";
import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, bodyOf, encryptToken, json, ownedBot, requireUser, sha256, telegram } from "../_lib/server.js";

type TelegramMe = { id: number; username?: string; first_name?: string };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.query.resource === "menus") return menuHandler(req,res);
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === "GET") {
      const result = await db.query(
        "SELECT id, username, display_name, status, last_error, connected_at, created_at FROM bots WHERE owner_id=$1 ORDER BY created_at DESC",
        [user.id],
      );
      return json(res, 200, { bots: result.rows });
    }
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    const token = String(bodyOf(req).token ?? "").trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) return json(res, 400, { error: "ساختار توکن ربات معتبر نیست." });

    const licenseResult = await db.query(
      `SELECT limits_snapshot FROM licenses
        WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now()
        ORDER BY expires_at DESC LIMIT 1`,
      [user.id],
    );
    if (!licenseResult.rowCount) return json(res, 403, { error: "برای اتصال ربات به لایسنس فعال نیاز دارید." });
    const botCount = await db.query("SELECT count(*)::int AS total FROM bots WHERE owner_id=$1", [user.id]);
    const maxBots = licenseResult.rows[0].limits_snapshot?.maxBots ?? 1;
    if (botCount.rows[0].total >= maxBots) return json(res, 403, { error: "سقف تعداد ربات در لایسنس شما تکمیل شده است." });

    const existing = await ownedBot(user.id);
    if (existing) return json(res, 409, { error: "برای این حساب قبلاً یک ربات ثبت شده است." });

    const me = await telegram<TelegramMe>(token, "getMe");
    const botId = crypto.randomUUID();
    const webhookSecret = randomBytes(32).toString("hex");
    if (process.env.VERCEL_ENV === "preview") {
      return json(res, 409, { error: "اعتبارسنجی توکن انجام شد؛ برای جلوگیری از ارسال webhook به نسخه اشتباه، اتصال واقعی ربات پس از انتشار نسخه اصلی فعال می‌شود." });
    }
    const appUrl = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
    if (!appUrl.startsWith("https://")) return json(res, 500, { error: "نشانی امن برنامه روی سرور تنظیم نشده است." });

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO bots (id, owner_id, telegram_bot_id, username, display_name, webhook_secret_hash, status, connected_at)
         VALUES ($1,$2,$3,$4,$5,$6,'active',now())`,
        [botId, user.id, me.id, me.username ?? null, me.first_name ?? null, sha256(webhookSecret)],
      );
      await client.query(
        "INSERT INTO bot_secrets (bot_id, encrypted_token) VALUES ($1,$2)",
        [botId, encryptToken(token)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      await telegram(token, "setWebhook", {
        url: `${appUrl}/api/telegram/webhook?botId=${botId}`,
        secret_token: webhookSecret,
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: false,
      });
    } catch (error) {
      await db.query("DELETE FROM bots WHERE id=$1 AND owner_id=$2", [botId, user.id]);
      return json(res, 502, { error: "ربات اعتبارسنجی شد اما ثبت webhook ناموفق بود. می‌توانی دوباره تلاش کنی یا با پشتیبانی تماس بگیری." });
    }
    return json(res, 201, { bot: { id: botId, username: me.username ?? null, display_name: me.first_name ?? null, status: "active" } });
  } catch (error) {
    console.error("bots_api_error", error);
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("telegram") || message.toLowerCase().includes("token") || message.toLowerCase().includes("unauthorized")) {
      return json(res, 400, { error: "توکن معتبر نیست یا تلگرام آن را نپذیرفت. توکن BotFather را بررسی کن." });
    }
    return json(res, 500, { error: "عملیات ربات انجام نشد." });
  }
}
