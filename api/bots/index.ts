import menuHandler from "../_lib/bot-menus.js";
import menuAppearanceHandler from "../_lib/bot-menu-appearance.js";
import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, bodyOf, decryptToken, encryptToken, json, ownedBot, requireUser, sha256, telegram } from "../_lib/server.js";

type TelegramMe = { id: number; username?: string; first_name?: string };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.query.resource === "menus") return menuHandler(req,res);
    if (req.query.resource === "menu-appearance") return menuAppearanceHandler(req,res);
    const user = await requireUser(req, res);
    if (!user) return;
    if (req.method === "POST" && req.query.resource === "webhook-reconnect") {
      if (process.env.VERCEL_ENV !== "preview") return json(res, 403, { error: "ثبت دوباره وبهوک فقط از نسخه آزمایشی مجاز است." });
      const rawBotId = bodyOf(req).botId;
      const botId = typeof rawBotId === "string" ? rawBotId : "";
      if (!botId) return json(res, 400, { error: "شناسه ربات الزامی است." });
      const bot = await ownedBot(user.id, botId);
      if (!bot || !bot.encrypted_token) return json(res, 404, { error: "ربات موردنظر پیدا نشد." });
      if (bot.status !== "active") return json(res, 409, { error: "ربات غیرفعال است." });
      if (process.env.ALLOW_PREVIEW_TELEGRAM_WEBHOOK !== "true") return json(res, 403, { error: "اتصال وبهوک در پیش‌نمایش فعال نشده است." });
      const appUrl = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
      if (!appUrl.startsWith("https://")) return json(res, 500, { error: "نشانی امن برنامه روی سرور تنظیم نشده است." });
      const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
      if (!bypassSecret) return json(res, 503, { error: "دسترسی امن وبهوک در پیش‌نمایش تنظیم نشده است." });
      const token = decryptToken(bot.encrypted_token);
      const current = await telegram<{ url?: string }>(token, "getWebhookInfo");
      if (current.url) {
        let currentUrl: URL;
        try { currentUrl = new URL(current.url); } catch { return json(res, 409, { error: "نشانی وبهوک فعلی معتبر نیست؛ تغییری انجام نشد." }); }
        const configured = new URL(appUrl);
        if (currentUrl.host !== configured.host || currentUrl.pathname !== "/api/telegram/webhook") return json(res, 409, { error: "این ربات به نشانی دیگری متصل است؛ وبهوک تغییر داده نشد." });
      }
      const webhookUrl = new URL(appUrl + "/api/telegram/webhook");
      webhookUrl.searchParams.set("botId", botId);
      webhookUrl.searchParams.set("x-vercel-protection-bypass", bypassSecret);
      const webhookSecret = randomBytes(32).toString("hex");
      const previousSecretHash = bot.webhook_secret_hash;
      await db.query("UPDATE bots SET webhook_secret_hash=$1 WHERE id=$2 AND owner_id=$3", [sha256(webhookSecret), botId, user.id]);
      try {
        await telegram(token, "setWebhook", { url: webhookUrl.toString(), secret_token: webhookSecret, allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: false });
      } catch (error) {
        await db.query("UPDATE bots SET webhook_secret_hash=$1 WHERE id=$2 AND owner_id=$3", [previousSecretHash, botId, user.id]);
        throw error;
      }
      return json(res, 200, { success: true, message: "وبهوک ربات در نسخه آزمایشی دوباره ثبت شد." });
    }
    if (req.method === "GET" && req.query.resource === "webhook-status") {
      const rawBotId = req.query.botId;
      const botId = Array.isArray(rawBotId) ? rawBotId[0] : rawBotId;
      const bot = await ownedBot(user.id, botId);
      if (!bot || !bot.encrypted_token) return json(res, 404, { error: "ربات موردنظر پیدا نشد." });
      const info = await telegram<{
        url?: string;
        pending_update_count?: number;
        ip_address?: string;
        last_error_date?: number;
        last_error_message?: string;
        max_connections?: number;
        allowed_updates?: string[];
        has_custom_certificate?: boolean;
      }>(decryptToken(bot.encrypted_token), "getWebhookInfo");
      let webhookHost: string | null = null;
      let webhookPath: string | null = null;
      if (info.url) {
        try {
          const parsed = new URL(info.url);
          webhookHost = parsed.host;
          webhookPath = parsed.pathname;
        } catch { /* Never return an unparsed webhook URL. */ }
      }
      return json(res, 200, {
        bot: { id: bot.id, username: bot.username, status: bot.status },
        webhook: {
          configured: Boolean(info.url),
          host: webhookHost,
          path: webhookPath,
          pending_update_count: info.pending_update_count ?? 0,
          ip_address: info.ip_address ?? null,
          last_error_date: info.last_error_date ?? null,
          last_error_message: info.last_error_message ?? null,
          max_connections: info.max_connections ?? null,
          allowed_updates: info.allowed_updates ?? null,
          has_custom_certificate: info.has_custom_certificate ?? false,
        },
      });
    }
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
    const isPreview = process.env.VERCEL_ENV === "preview";
    if (isPreview && process.env.ALLOW_PREVIEW_TELEGRAM_WEBHOOK !== "true") {
      return json(res, 403, { error: "اتصال ربات در پیش‌نمایش هنوز فعال نشده است." });
    }
    const appUrl = (process.env.APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
    if (!appUrl.startsWith("https://")) return json(res, 500, { error: "نشانی امن برنامه روی سرور تنظیم نشده است." });
    const webhookUrl = new URL(`${appUrl}/api/telegram/webhook`);
    webhookUrl.searchParams.set("botId", botId);
    if (isPreview) {
      const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
      if (!bypassSecret) return json(res, 503, { error: "دسترسی امن وبهوک در پیش‌نمایش تنظیم نشده است." });
      webhookUrl.searchParams.set("x-vercel-protection-bypass", bypassSecret);
    }
    if (isPreview) {
      const configuredHost = new URL(appUrl).host;
      const webhookInfo = await telegram<{ url?: string }>(token, "getWebhookInfo");
      if (webhookInfo.url) {
        let currentHost = "";
        try { currentHost = new URL(webhookInfo.url).host; } catch { /* malformed webhook URL is treated as unsafe */ }
        if (!currentHost || currentHost !== configuredHost) {
          return json(res, 409, { error: "این ربات از قبل به نشانی دیگری متصل است. برای جلوگیری از قطع ربات اصلی، وبهوک تغییر داده نشد؛ از یک ربات آزمایشی تازه استفاده کن." });
        }
      }
    }

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
        url: webhookUrl.toString(),
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
