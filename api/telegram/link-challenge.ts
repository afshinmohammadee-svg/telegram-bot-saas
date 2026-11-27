import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { currentUser, db, json, sha256, telegram } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "برای اتصال تلگرام ابتدا وارد حساب شو." });
    const recent = await db.query(
      "SELECT count(*)::int AS total FROM telegram_link_challenges WHERE user_id=$1 AND created_at>now()-interval '10 minutes'",
      [user.id],
    );
    if (recent.rows[0].total >= 5) return json(res, 429, { error: "تعداد درخواست لینک زیاد است؛ چند دقیقه دیگر دوباره تلاش کن." });
    const token = randomBytes(24).toString("base64url");
    await db.query("UPDATE telegram_link_challenges SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL", [user.id]);
    await db.query(
      `INSERT INTO telegram_link_challenges (user_id,token_hash,expires_at)
       VALUES ($1,$2,now()+interval '10 minutes')`,
      [user.id, sha256(token)],
    );
    // Resolve the username from the exact bot token configured in this deployment.
    // Never use a hard-coded/default username: it can send Preview customers to the
    // legacy Vercel/Production bot even when Preview has a different central bot token.
    const managementToken = process.env.MANAGEMENT_BOT_TOKEN;
    if (!managementToken) {
      return json(res, 503, { error: "ربات مرکزی این محیط هنوز پیکربندی نشده است." });
    }
    const identity = await telegram<{ id: number; username?: string }>(managementToken, "getMe");
    const username = (identity.username ?? "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
      return json(res, 503, { error: "نام کاربری ربات مرکزی از تلگرام دریافت نشد؛ تنظیمات ربات را بررسی کن." });
    }
    return json(res, 201, {
      url: `https://t.me/${username}?start=${token}`,
      expiresInSeconds: 600,
      instructions: "لینک را فقط در تلگرام خودت باز کن و Start را بزن. این لینک یک‌بارمصرف و ۱۰ دقیقه معتبر است.",
    });
  } catch (error) {
    console.error("telegram_link_challenge_error", error);
    return json(res, 500, { error: "ساخت لینک اتصال تلگرام ناموفق بود." });
  }
}
