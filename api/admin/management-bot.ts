import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { json, requireUser, safeEqualHex, sha256, telegram } from "../_lib/server.js";

function isPreview() {
  return process.env.VERCEL_ENV === "preview" ||
    process.env.RAILWAY_ENVIRONMENT_NAME === "preview" ||
    process.env.DEPLOY_ENV === "preview";
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const actor = await requireUser(req, res);
    if (!actor) return;
    if (actor.role !== "super_admin") return json(res, 403, { error: "دسترسی مدیر کل لازم است." });
    if (!isPreview()) return json(res, 403, { error: "مدیریت ربات مرکزی از این مسیر فقط در Preview مجاز است." });

    const token = process.env.MANAGEMENT_BOT_TOKEN;
    const secret = process.env.MANAGEMENT_BOT_WEBHOOK_SECRET;
    const rawAppUrl = process.env.APP_URL ?? "";
    if (!token || !secret) return json(res, 503, { configured: false, error: "متغیرهای امن MANAGEMENT_BOT_TOKEN و MANAGEMENT_BOT_WEBHOOK_SECRET در Preview تنظیم نشده‌اند." });

    if (req.method === "GET") {
      const [me, info] = await Promise.all([
        telegram<{ id: number; username?: string; first_name?: string }>(token, "getMe"),
        telegram<{ url?: string; pending_update_count?: number; has_custom_certificate?: boolean }>(token, "getWebhookInfo"),
      ]);
      let expectedUrl = "";
      try { expectedUrl = new URL("/api/telegram/management-webhook", rawAppUrl).toString(); } catch {}
      return json(res, 200, {
        configured: true,
        bot: { id: me.id, username: me.username ?? null, firstName: me.first_name ?? null },
        webhookConfigured: Boolean(info.url && expectedUrl && info.url.startsWith(expectedUrl)),
        pendingUpdates: info.pending_update_count ?? 0,
        appUrlConfigured: Boolean(expectedUrl),
      });
    }

    if (req.method === "POST") {
      let appUrl: URL;
      try { appUrl = new URL(rawAppUrl); } catch { return json(res, 503, { error: "APP_URL معتبر برای Preview تنظیم نشده است." }); }
      if (appUrl.protocol !== "https:" || !appUrl.hostname.endsWith("up.railway.app")) {
        return json(res, 403, { error: "نشانی امن Railway Preview برای وبهوک تنظیم نشده است." });
      }
      const webhookUrl = new URL("/api/telegram/management-webhook", appUrl);
      await telegram(token, "setWebhook", {
        url: webhookUrl.toString(),
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: false,
      });
      const info = await telegram<{ url?: string; pending_update_count?: number }>(token, "getWebhookInfo");
      return json(res, 200, { success: true, webhookConfigured: Boolean(info.url && info.url.startsWith(webhookUrl.toString())), pendingUpdates: info.pending_update_count ?? 0 });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("admin_management_bot_error", error);
    return json(res, 502, { error: "بررسی یا راه‌اندازی ربات مرکزی ناموفق بود. تنظیمات امن و دسترسی تلگرام را بررسی کن." });
  }
}
