import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, json, safeEqualHex, sha256, telegram } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const secret = process.env.CRON_SECRET;
  const authorization = req.headers.authorization;
  if (!secret || typeof authorization !== "string" || !authorization.startsWith("Bearer ") || !safeEqualHex(sha256(authorization.slice(7)), sha256(secret))) return json(res, 401, { error: "Unauthorized" });
  const token = process.env.MANAGEMENT_BOT_TOKEN;
  if (!token) return json(res, 503, { error: "Management bot is not configured" });

  const today = await db.query("SELECT (now() AT TIME ZONE 'UTC')::date::text AS day");
  const scheduledFor = today.rows[0].day;
  const due = await db.query(
    "SELECT l.id,l.expires_at,l.user_id,(l.expires_at AT TIME ZONE 'UTC')::date - $1::date AS days_left,a.telegram_user_id,u.name " +
    "FROM licenses l JOIN customer_telegram_accounts a ON a.user_id=l.user_id JOIN \"user\" u ON u.id=l.user_id " +
    "WHERE l.status='active' AND (l.expires_at AT TIME ZONE 'UTC')::date IN ($1::date + 30,$1::date + 7,$1::date + 1) " +
    "ORDER BY l.expires_at ASC LIMIT 500",
    [scheduledFor],
  );

  let sent = 0;
  let skipped = 0;
  for (const item of due.rows as Array<{id:string;expires_at:Date|string;days_left:number;telegram_user_id:string|number;name:string}>) {
    const days = Number(item.days_left);
    if (![30,7,1].includes(days)) continue;
    const claim = await db.query(
      "INSERT INTO license_reminder_log(license_id,reminder_days,scheduled_for,telegram_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id",
      [item.id,days,scheduledFor,item.telegram_user_id],
    );
    if (!claim.rowCount) { skipped++; continue; }
    try {
      const date = new Date(item.expires_at).toLocaleDateString("fa-IR", { timeZone: "UTC" });
      const urgency = days === 1 ? "⚠️" : "⏳";
      const message = [urgency + " یادآوری تمدید لایسنس تلگرام‌یار", "", "سلام " + item.name + "، فقط " + days + " روز تا پایان اعتبار لایسنس شما باقی مانده است.", "تاریخ انقضا: " + date, "", "برای جلوگیری از توقف پاسخ‌گویی ربات‌ها، با مدیر پلتفرم جهت تمدید هماهنگ کن."].join("\n");
      await telegram(token, "sendMessage", { chat_id: item.telegram_user_id, text: message, disable_web_page_preview: true });
      sent++;
    } catch (error) {
      await db.query("DELETE FROM license_reminder_log WHERE id=$1", [claim.rows[0].id]);
      console.error("license_reminder_send_error", { licenseId: item.id, days, error });
    }
  }
  return json(res, 200, { ok: true, scheduledFor, due: due.rowCount, sent, skipped });
}
