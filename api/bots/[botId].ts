import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, decryptToken, json, ownedBot, requireUser, telegram } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "DELETE") return json(res, 405, { error: "Method not allowed" });
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const rawId = req.query.botId;
    const botId = Array.isArray(rawId) ? rawId[0] : rawId;
    const bot = await ownedBot(user.id, botId);
    if (!bot) return json(res, 404, { error: "ربات پیدا نشد." });
    if (bot.encrypted_token) {
      try { await telegram(decryptToken(bot.encrypted_token), "deleteWebhook", { drop_pending_updates: false }); }
      catch (error) { console.warn("telegram_webhook_remove_failed", error); }
    }
    await db.query("UPDATE bots SET status='disabled', updated_at=now() WHERE id=$1 AND owner_id=$2", [bot.id, user.id]);
    return json(res, 200, { success: true });
  } catch (error) {
    console.error("bot_disable_error", error);
    return json(res, 500, { error: "غیرفعال‌سازی ربات ناموفق بود." });
  }
}
