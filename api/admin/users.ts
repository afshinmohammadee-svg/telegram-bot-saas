import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { bodyOf, db, json, requireUser } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const actor = await requireUser(req, res);
    if (!actor) return;
    if (actor.role !== "super_admin") return json(res, 403, { error: "دسترسی مدیر کل لازم است." });

    if (req.method === "GET") {
      const result = await db.query(
        `SELECT u.id,u.name,u.email,u.role,s.expires_at,
                (s.expires_at IS NOT NULL AND s.starts_at<=now() AND s.expires_at>now()) AS subscription_active
           FROM "user" u LEFT JOIN subscriptions s ON s.user_id=u.id
          ORDER BY u.created_at DESC LIMIT 200`,
      );
      return json(res, 200, { users: result.rows });
    }

    if (req.method === "PATCH") {
      const rawId = req.query.id;
      const userId = Array.isArray(rawId) ? rawId[0] : rawId;
      const expiresAtInput = String(bodyOf(req).expiresAt ?? "");
      if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAtInput)) {
        return json(res, 400, { error: "کاربر و تاریخ انقضا را مشخص کن." });
      }
      const expiresAt = new Date(`${expiresAtInput}T23:59:59.999Z`);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        return json(res, 400, { error: "تاریخ انقضا باید در آینده باشد." });
      }
      const exists = await db.query('SELECT id FROM "user" WHERE id=$1 AND role<>$2 LIMIT 1', [userId, "super_admin"]);
      if (!exists.rowCount) return json(res, 404, { error: "کاربر عادی پیدا نشد." });
      await db.query(
        `INSERT INTO subscriptions (user_id,starts_at,expires_at,created_by)
         VALUES ($1,now(),$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET starts_at=now(),expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by,updated_at=now()`,
        [userId, expiresAt.toISOString(), actor.id],
      );
      await db.query(
        "INSERT INTO audit_logs (actor_user_id,target_user_id,action,metadata) VALUES ($1,$2,$3,$4::jsonb)",
        [actor.id,userId,"subscription.updated",JSON.stringify({ expiresAt: expiresAt.toISOString() })],
      );
      return json(res, 200, { success: true, expiresAt: expiresAt.toISOString() });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("admin_users_api_error", error);
    return json(res, 500, { error: "عملیات مدیریت کاربران ناموفق بود." });
  }
}
