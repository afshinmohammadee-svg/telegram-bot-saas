import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { bodyOf, db, json, ownedBot, requireUser } from "../_lib/server.js";

const responseTypes = new Set(["text", "photo", "document", "url", "submenu"]);

async function activeMenuLicense(userId: string) {
  const result = await db.query(
    `SELECT l.limits_snapshot,l.features_snapshot
       FROM licenses l
      WHERE l.user_id=$1 AND l.status='active'
        AND l.starts_at<=now() AND l.expires_at>now()
      ORDER BY l.expires_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const bot = await ownedBot(user.id);
    if (!bot) return json(res, 409, { error: "ابتدا ربات تلگرام خود را متصل کن." });

    const license = await activeMenuLicense(user.id);
    if (!license) return json(res, 403, { error: "لایسنس فعال ندارید یا اعتبار آن تمام شده است." });
    const features = license.features_snapshot ?? {};
    if (features.menuBuilder !== true) return json(res, 403, { error: "امکان منوساز در لایسنس شما فعال نیست." });

    if (req.method === "GET") {
      const result = await db.query(
        `SELECT id,bot_id,title,description,parent_id,response_type,response_content,target_url,
                sort_order,is_active,created_at,updated_at
           FROM bot_menus WHERE bot_id=$1 ORDER BY sort_order,title`,
        [bot.id],
      );
      return json(res, 200, { menus: result.rows, limit: license.limits_snapshot?.maxMenus ?? null });
    }

    if (req.method === "POST") {
      const body = bodyOf(req);
      const title = String(body.title ?? "").trim().slice(0, 120);
      const description = String(body.description ?? "").trim().slice(0, 1000) || null;
      const parentId = String(body.parentId ?? "").trim() || null;
      const responseType = String(body.responseType ?? "text");
      const responseContent = String(body.responseContent ?? "").trim().slice(0, 4000);
      const targetUrl = String(body.targetUrl ?? "").trim();
      if (!title) return json(res, 400, { error: "عنوان منو الزامی است." });
      if (!responseTypes.has(responseType)) return json(res, 400, { error: "نوع پاسخ معتبر نیست." });
      if (responseType === "url" && !/^https:\/\//i.test(targetUrl)) return json(res, 400, { error: "لینک باید با https شروع شود." });
      if (responseType !== "submenu" && responseType !== "url" && !responseContent) return json(res, 400, { error: "محتوای پاسخ الزامی است." });
      if (parentId) {
        const parent = await db.query("SELECT id FROM bot_menus WHERE id=$1 AND bot_id=$2", [parentId, bot.id]);
        if (!parent.rowCount) return json(res, 400, { error: "منوی والد معتبر نیست." });
      }
      const limit = license.limits_snapshot?.maxMenus;
      const count = await db.query("SELECT count(*)::int AS total FROM bot_menus WHERE bot_id=$1", [bot.id]);
      if (Number.isInteger(limit) && count.rows[0].total >= limit) return json(res, 403, { error: "سقف تعداد منو در لایسنس شما تکمیل شده است." });
      const sortOrder = Number.isInteger(body.sortOrder) ? Number(body.sortOrder) : 0;
      const result = await db.query(
        `INSERT INTO bot_menus
          (bot_id,title,payload,description,parent_id,response_type,response_content,target_url,sort_order,is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
         RETURNING id,bot_id,title,description,parent_id,response_type,response_content,target_url,sort_order,is_active,created_at,updated_at`,
        [bot.id,title,responseContent || title,description,parentId,responseType,responseContent || null,targetUrl || null,sortOrder],
      );
      return json(res, 201, { menu: result.rows[0] });
    }

    const rawId = req.query.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id) return json(res, 400, { error: "شناسه منو الزامی است." });

    if (req.method === "PATCH") {
      const body = bodyOf(req);
      const current = await db.query("SELECT id,parent_id FROM bot_menus WHERE id=$1 AND bot_id=$2", [id,bot.id]);
      if (!current.rowCount) return json(res, 404, { error: "منو پیدا نشد." });
      const title = body.title === undefined ? undefined : String(body.title).trim().slice(0,120);
      const description = body.description === undefined ? undefined : String(body.description).trim().slice(0,1000) || null;
      const parentId = body.parentId === undefined ? undefined : String(body.parentId || "").trim() || null;
      const responseType = body.responseType === undefined ? undefined : String(body.responseType);
      const responseContent = body.responseContent === undefined ? undefined : String(body.responseContent).trim().slice(0,4000);
      const targetUrl = body.targetUrl === undefined ? undefined : String(body.targetUrl).trim();
      if (responseType && !responseTypes.has(responseType)) return json(res, 400, { error: "نوع پاسخ معتبر نیست." });
      if (responseType === "url" && targetUrl !== undefined && !/^https:\/\//i.test(targetUrl)) return json(res, 400, { error: "لینک باید با https شروع شود." });
      if (parentId) {
        if (parentId === id) return json(res, 400, { error: "یک منو نمی‌تواند والد خودش باشد." });
        const parent = await db.query("SELECT id FROM bot_menus WHERE id=$1 AND bot_id=$2", [parentId,bot.id]);
        if (!parent.rowCount) return json(res, 400, { error: "منوی والد معتبر نیست." });
        const cycle = await db.query(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM bot_menus WHERE parent_id=$1 AND bot_id=$2
             UNION ALL SELECT m.id FROM bot_menus m JOIN descendants d ON m.parent_id=d.id WHERE m.bot_id=$2
           ) SELECT 1 FROM descendants WHERE id=$3 LIMIT 1`,
          [id,bot.id,parentId],
        );
        if (cycle.rowCount) return json(res, 400, { error: "ساختار والد باعث ایجاد حلقه می‌شود." });
      }
      const result = await db.query(
        `UPDATE bot_menus SET
           title=COALESCE($3,title), description=CASE WHEN $4 THEN $5 ELSE description END,
           parent_id=CASE WHEN $6 THEN $7::uuid ELSE parent_id END,
           response_type=COALESCE($8,response_type),
           response_content=CASE WHEN $9 THEN $10 ELSE response_content END,
           payload=CASE WHEN $9 THEN COALESCE($10,title) ELSE payload END,
           target_url=CASE WHEN $11 THEN $12 ELSE target_url END,
           sort_order=COALESCE($13,sort_order), is_active=COALESCE($14,is_active), updated_at=now()
         WHERE id=$1 AND bot_id=$2
         RETURNING id,bot_id,title,description,parent_id,response_type,response_content,target_url,sort_order,is_active,created_at,updated_at`,
        [id,bot.id,title ?? null,description !== undefined,description,parentId !== undefined,parentId ?? null,responseType ?? null,responseContent !== undefined,responseContent ?? null,targetUrl !== undefined,targetUrl ?? null,Number.isInteger(body.sortOrder)?Number(body.sortOrder):null,typeof body.isActive==="boolean"?body.isActive:null],
      );
      return json(res, 200, { menu: result.rows[0] });
    }

    if (req.method === "DELETE") {
      await db.query("DELETE FROM bot_menus WHERE id=$1 AND bot_id=$2", [id,bot.id]);
      return json(res, 200, { success: true });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("bot_menus_api_error", error);
    return json(res, 500, { error: "ذخیره یا دریافت منوها ناموفق بود." });
  }
}
