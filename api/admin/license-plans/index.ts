import type { ApiRequest, ApiResponse } from "../../_lib/server.js";
import { bodyOf, db, json, requireUser } from "../../_lib/server.js";

const cleanText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const actor = await requireUser(req, res);
    if (!actor) return;
    if (actor.role !== "super_admin") return json(res, 403, { error: "دسترسی مدیر کل لازم است." });

    if (req.method === "GET") {
      const result = await db.query(
        `SELECT p.id,p.code,p.name,p.description,p.duration_days,p.max_bots,p.max_menus,
                p.max_visitors,p.features,p.is_active,p.created_at,
                count(l.id)::int AS issued_count
           FROM license_plans p LEFT JOIN licenses l ON l.plan_id=p.id
          GROUP BY p.id ORDER BY p.created_at DESC`,
      );
      return json(res, 200, { plans: result.rows });
    }

    const body = bodyOf(req);
    if (req.method === "POST") {
      const code = cleanText(body.code, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      const name = cleanText(body.name, 100);
      const durationDays = Number(body.durationDays);
      const maxBots = Number(body.maxBots ?? 1);
      const maxMenus = Number(body.maxMenus ?? 20);
      const maxVisitors = body.maxVisitors === "" || body.maxVisitors == null ? null : Number(body.maxVisitors);
      const description = cleanText(body.description, 500);
      const features = body.features && typeof body.features === "object" && !Array.isArray(body.features) ? body.features : {};
      if (!code || !name || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650 ||
          !Number.isInteger(maxBots) || maxBots < 1 || maxBots > 100 ||
          !Number.isInteger(maxMenus) || maxMenus < 0 || maxMenus > 10000 ||
          (maxVisitors !== null && (!Number.isSafeInteger(maxVisitors) || maxVisitors < 0))) {
        return json(res, 400, { error: "اطلاعات پلن معتبر نیست؛ نام، شناسه، مدت و محدودیت‌ها را بررسی کن." });
      }
      const result = await db.query(
        `INSERT INTO license_plans
          (code,name,description,duration_days,max_bots,max_menus,max_visitors,features,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING id,code,name,description,duration_days,max_bots,max_menus,max_visitors,features,is_active,created_at`,
        [code,name,description || null,durationDays,maxBots,maxMenus,maxVisitors,JSON.stringify(features),actor.id],
      );
      await db.query(
        "INSERT INTO audit_logs (actor_user_id,action,metadata) VALUES ($1,$2,$3::jsonb)",
        [actor.id,"license_plan.created",JSON.stringify({ planId: result.rows[0].id, code })],
      );
      return json(res, 201, { plan: result.rows[0] });
    }

    if (req.method === "PATCH") {
      const rawId = req.query.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      const active = body.isActive;
      if (!id || typeof active !== "boolean") return json(res, 400, { error: "شناسه پلن و وضعیت فعال‌بودن لازم است." });
      const result = await db.query(
        "UPDATE license_plans SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id,is_active",
        [id,active],
      );
      if (!result.rowCount) return json(res, 404, { error: "پلن پیدا نشد." });
      await db.query(
        "INSERT INTO audit_logs (actor_user_id,action,metadata) VALUES ($1,$2,$3::jsonb)",
        [actor.id,"license_plan.status_changed",JSON.stringify({ planId:id,isActive:active })],
      );
      return json(res, 200, { plan: result.rows[0] });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("admin_license_plans_error", error);
    return json(res, 500, { error: "مدیریت پلن‌ها ناموفق بود. شناسه پلن باید یکتا باشد." });
  }
}
