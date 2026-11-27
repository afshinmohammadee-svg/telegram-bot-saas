import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { bodyOf, db, json, requireUser } from "../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const actor = await requireUser(req, res);
    if (!actor) return;
    if (actor.role !== "super_admin") return json(res, 403, { error: "دسترسی مدیر کل لازم است." });

    if (req.method === "GET") {
      const result = await db.query(
        `SELECT u.id,u.name,u.email,u.role,COALESCE(l.expires_at,s.expires_at) AS expires_at,
                CASE WHEN l.id IS NOT NULL
                  THEN (l.status='active' AND l.starts_at<=now() AND l.expires_at>now())
                  ELSE (s.expires_at IS NOT NULL AND s.starts_at<=now() AND s.expires_at>now())
                END AS subscription_active
           FROM "user" u
           LEFT JOIN subscriptions s ON s.user_id=u.id
           LEFT JOIN LATERAL (
             SELECT id,status,starts_at,expires_at FROM licenses
              WHERE user_id=u.id ORDER BY created_at DESC LIMIT 1
           ) l ON true
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
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString().slice(0, 10) !== expiresAtInput || expiresAt.getTime() <= Date.now()) {
        return json(res, 400, { error: "تاریخ انقضا باید یک تاریخ معتبر در آینده باشد." });
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const exists = await client.query('SELECT id FROM "user" WHERE id=$1 AND role<>$2 FOR UPDATE', [userId, "super_admin"]);
        if (!exists.rowCount) {
          await client.query("ROLLBACK");
          return json(res, 404, { error: "کاربر عادی پیدا نشد." });
        }
        const license = await client.query(
          "SELECT id FROM licenses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
          [userId],
        );
        if (license.rowCount) {
          await client.query(
            "UPDATE licenses SET expires_at=$2,status='active',updated_at=now() WHERE id=$1",
            [license.rows[0].id, expiresAt.toISOString()],
          );
          await client.query(
            `INSERT INTO subscriptions(user_id,starts_at,expires_at,created_by,license_id)
             VALUES($1,now(),$2,$3,$4)
             ON CONFLICT(user_id) DO UPDATE SET starts_at=LEAST(subscriptions.starts_at,now()),
               expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by,
               license_id=EXCLUDED.license_id,updated_at=now()`,
            [userId, expiresAt.toISOString(), actor.id, license.rows[0].id],
          );
        } else {
          await client.query(
            `INSERT INTO subscriptions(user_id,starts_at,expires_at,created_by)
             VALUES($1,now(),$2,$3)
             ON CONFLICT(user_id) DO UPDATE SET starts_at=now(),expires_at=EXCLUDED.expires_at,
               created_by=EXCLUDED.created_by,updated_at=now()`,
            [userId, expiresAt.toISOString(), actor.id],
          );
        }
        await client.query(
          "INSERT INTO audit_logs(actor_user_id,target_user_id,action,metadata) VALUES($1,$2,$3,$4::jsonb)",
          [actor.id,userId,license.rowCount ? "license.expiry_updated" : "subscription.updated",JSON.stringify({ expiresAt: expiresAt.toISOString() })],
        );
        await client.query("COMMIT");
        return json(res, 200, { success: true, expiresAt: expiresAt.toISOString() });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("admin_users_api_error", error);
    return json(res, 500, { error: "عملیات مدیریت کاربران ناموفق بود." });
  }
}
