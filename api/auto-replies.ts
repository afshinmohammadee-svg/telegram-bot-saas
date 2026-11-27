import type { ApiRequest, ApiResponse } from "./_lib/server.js";
import { bodyOf, db, json, ownedBot, requireUser } from "./_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const bot = await ownedBot(user.id);
    if (req.method === "GET") {
      if (!bot) return json(res, 200, { rules: [] });
      const result = await db.query("SELECT id,trigger_text,reply_text,match_type,is_enabled,created_at FROM auto_replies WHERE bot_id=$1 ORDER BY created_at DESC", [bot.id]);
      return json(res, 200, { rules: result.rows });
    }
    if (!bot) return json(res, 409, { error: "ابتدا ربات خود را متصل کنید." });
    if (req.method === "POST") {
      const body = bodyOf(req);
      const trigger = String(body.trigger_text ?? "").trim();
      const reply = String(body.reply_text ?? "").trim();
      const matchType = String(body.match_type ?? "contains");
      if (!trigger || trigger.length > 200 || !reply || reply.length > 4000 || !["exact","contains","starts_with"].includes(matchType)) {
        return json(res, 400, { error: "مقادیر پاسخ خودکار معتبر نیستند." });
      }
      const result = await db.query(
        "INSERT INTO auto_replies (bot_id,trigger_text,reply_text,match_type) VALUES ($1,$2,$3,$4) RETURNING id,trigger_text,reply_text,match_type,is_enabled,created_at",
        [bot.id, trigger, reply, matchType],
      );
      return json(res, 201, { rule: result.rows[0] });
    }
    const rawRuleId = req.query.id;
    const ruleId = Array.isArray(rawRuleId) ? rawRuleId[0] : rawRuleId;
    if (!ruleId) return json(res, 400, { error: "شناسه قانون الزامی است." });
    if (req.method === "PATCH") {
      const body = bodyOf(req);
      const result = await db.query(
        "UPDATE auto_replies SET is_enabled=COALESCE($3,is_enabled),trigger_text=COALESCE($4,trigger_text),reply_text=COALESCE($5,reply_text),match_type=COALESCE($6,match_type),updated_at=now() WHERE id=$1 AND bot_id=$2 RETURNING id,trigger_text,reply_text,match_type,is_enabled,created_at",
        [ruleId,bot.id,typeof body.is_enabled==="boolean"?body.is_enabled:null,typeof body.trigger_text==="string"?body.trigger_text:null,typeof body.reply_text==="string"?body.reply_text:null,["exact","contains","starts_with"].includes(String(body.match_type))?body.match_type:null],
      );
      return result.rowCount ? json(res, 200, { rule: result.rows[0] }) : json(res, 404, { error: "قانون پیدا نشد." });
    }
    if (req.method === "DELETE") {
      const result = await db.query("DELETE FROM auto_replies WHERE id=$1 AND bot_id=$2 RETURNING id", [ruleId,bot.id]);
      return result.rowCount ? json(res, 200, { success: true }) : json(res, 404, { error: "قانون پیدا نشد." });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("auto_replies_api_error", error);
    return json(res, 500, { error: "عملیات پاسخ خودکار ناموفق بود." });
  }
}
