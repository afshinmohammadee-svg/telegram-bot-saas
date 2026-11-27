import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { json, safeEqualHex, sha256, telegram } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const isPreview = process.env.VERCEL_ENV === "preview" || process.env.RAILWAY_ENVIRONMENT_NAME === "preview" || process.env.DEPLOY_ENV === "preview";
  if (!isPreview) return json(res, 403, { error: "راه‌اندازی وبهوک فقط در محیط آزمایشی مجاز است." });

  const token = process.env.MANAGEMENT_BOT_TOKEN;
  const secret = process.env.MANAGEMENT_BOT_WEBHOOK_SECRET;
  const supplied = req.headers["x-management-setup-secret"];
  if (!token || !secret) return json(res, 503, { error: "تنظیمات ربات مدیریت کامل نیست." });
  if (typeof supplied !== "string" || !safeEqualHex(sha256(supplied), sha256(secret))) {
    return json(res, 401, { error: "دسترسی غیرمجاز." });
  }

  const rawAppUrl = process.env.APP_URL ?? "";
  const bypass = process.env.VERCEL_ENV === "preview" ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() : undefined;
  let appUrl: URL;
  try { appUrl = new URL(rawAppUrl); } catch { return json(res, 503, { error: "APP_URL معتبر برای Preview تنظیم نشده است." }); }
  if (appUrl.protocol !== "https:" || (process.env.VERCEL_ENV === "preview" && !bypass)) {
    return json(res, 503, { error: "نشانی یا دسترسی امن محیط آزمایشی تنظیم نشده است." });
  }

  const webhookUrl = new URL("/api/telegram/management-webhook", appUrl);
  if (bypass) webhookUrl.searchParams.set("x-vercel-protection-bypass", bypass);
  try {
    await telegram(token, "setWebhook", {
      url: webhookUrl.toString(),
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    const info = await telegram<{ pending_update_count?: number; has_custom_certificate?: boolean }>(token, "getWebhookInfo");
    return json(res, 200, {
      success: true,
      webhook: "configured",
      pendingUpdates: info.pending_update_count ?? 0,
      hasCustomCertificate: info.has_custom_certificate ?? false,
    });
  } catch (error) {
    console.error("management_webhook_setup_error", error);
    return json(res, 502, { error: "ثبت وبهوک در تلگرام ناموفق بود." });
  }
}
