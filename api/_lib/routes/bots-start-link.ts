import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../server.js";
import { bodyOf, currentUser, db, json, sha256 } from "../server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await currentUser(req);
    if (!user) return json(res, 401, { error: "ابتدا وارد حساب شو." });
    const body = bodyOf(req);
    const botId = typeof body.botId === "string" ? body.botId : "";
    const menuId = typeof body.menuId === "string" && body.menuId ? body.menuId : null;
    const sourceLabel = typeof body.sourceLabel === "string" ? body.sourceLabel.trim().slice(0, 80) : null;
    if (!/^[0-9a-f-]{36}$/i.test(botId)) return json(res, 400, { error: "شناسه ربات معتبر نیست." });

    const bot = await db.query(
      "SELECT id,username,status FROM bots WHERE id=$1 AND owner_id=$2 LIMIT 1",
      [botId, user.id],
    );
    if (!bot.rowCount) return json(res, 404, { error: "ربات متعلق به این حساب پیدا نشد." });
    if (bot.rows[0].status !== "active") return json(res, 409, { error: "ربات غیرفعال است." });

    const license = await db.query(
      `SELECT 1 FROM licenses WHERE user_id=$1 AND status='active'
        AND starts_at<=now() AND expires_at>now() LIMIT 1`,
      [user.id],
    );
    if (!license.rowCount) return json(res, 403, { error: "برای ساخت لینک QR به لایسنس فعال نیاز داری." });

    if (menuId) {
      const menu = await db.query("SELECT id FROM bot_menus WHERE id=$1 AND bot_id=$2 AND is_active=true", [menuId, botId]);
      if (!menu.rowCount) return json(res, 400, { error: "منوی انتخاب‌شده متعلق به این ربات نیست یا فعال نیست." });
    }

    const username = String(bot.rows[0].username ?? "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return json(res, 409, { error: "نام کاربری ربات در تلگرام ثبت نشده است." });
    const payload = randomBytes(24).toString("base64url");
    await db.query(
      `INSERT INTO bot_start_links(bot_id,token_hash,source_label,created_by,menu_id)
       VALUES($1,$2,$3,$4,$5)`,
      [botId, sha256(payload), sourceLabel, user.id, menuId],
    );
    const deepLink = `https://t.me/${username}?start=${payload}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(deepLink)}`;
    return json(res, 201, { deepLink, qrImageUrl, payloadExpires: null, instructions: "کاربر QR را اسکن می‌کند، وارد چت ربات می‌شود و باید دکمه Start را بزند. لینک برای استفاده مجدد معتبر است." });
  } catch (error) {
    console.error("bot_start_link_error", error);
    return json(res, 500, { error: "ساخت لینک QR ناموفق بود." });
  }
}
