import type { ApiRequest, ApiResponse } from "../../_lib/server.js";
import { bodyOf, db, json, requireUser } from "../../_lib/server.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const actor = await requireUser(req, res);
    if (!actor) return;
    if (actor.role !== "super_admin") return json(res, 403, { error: "دسترسی مدیر کل لازم است." });

    if (req.method === "GET") {
      const result = await db.query(
        `SELECT l.id,l.user_id,l.plan_id,l.status,l.starts_at,l.expires_at,l.notes,l.created_at,
                u.name AS user_name,u.email AS user_email,p.name AS plan_name,p.code AS plan_code
           FROM licenses l
           LEFT JOIN "user" u ON u.id=l.user_id
           JOIN license_plans p ON p.id=l.plan_id
          ORDER BY l.created_at DESC LIMIT 500`,
      );
      return json(res, 200, { licenses: result.rows });
    }

    const body = bodyOf(req);
    if (req.method === "POST") {
      const userId = String(body.userId ?? "");
      const planId = String(body.planId ?? "");
      const notes = String(body.notes ?? "").trim().slice(0,1000) || null;
      if (!userId || !planId) return json(res, 400, { error: "مشتری و پلن را انتخاب کن." });

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const customer = await client.query('SELECT id FROM "user" WHERE id=$1 AND role<>$2 FOR UPDATE', [userId,"super_admin"]);
        if (!customer.rowCount) {
          await client.query("ROLLBACK");
          return json(res, 404, { error: "مشتری معتبر پیدا نشد." });
        }
        const planResult = await client.query(
          "SELECT id,name,duration_days,max_bots,max_menus,max_visitors,features FROM license_plans WHERE id=$1 AND is_active=true",
          [planId],
        );
        if (!planResult.rowCount) {
          await client.query("ROLLBACK");
          return json(res, 404, { error: "پلن فعال پیدا نشد." });
        }
        const plan = planResult.rows[0];
        const start = new Date();
        const expiry = new Date(start.getTime() + Number(plan.duration_days) * 86400000);
        await client.query(
          "UPDATE licenses SET status='expired',updated_at=now() WHERE user_id=$1 AND status='active'",
          [userId],
        );
        const inserted = await client.query(
          `INSERT INTO licenses
            (plan_id,user_id,status,starts_at,expires_at,limits_snapshot,features_snapshot,notes,created_by)
           VALUES ($1,$2,'active',$3,$4,$5::jsonb,$6::jsonb,$7,$8)
           RETURNING id,status,starts_at,expires_at`,
          [planId,userId,start.toISOString(),expiry.toISOString(),
           JSON.stringify({ maxBots:plan.max_bots,maxMenus:plan.max_menus,maxVisitors:plan.max_visitors }),
           JSON.stringify(plan.features ?? {}),notes,actor.id],
        );
        const license = inserted.rows[0];
        await client.query(
          `INSERT INTO subscriptions (user_id,starts_at,expires_at,created_by,license_id)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id) DO UPDATE SET starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,
             created_by=EXCLUDED.created_by,license_id=EXCLUDED.license_id,updated_at=now()`,
          [userId,start.toISOString(),expiry.toISOString(),actor.id,license.id],
        );
        await client.query(
          "INSERT INTO audit_logs (actor_user_id,target_user_id,action,metadata) VALUES ($1,$2,$3,$4::jsonb)",
          [actor.id,userId,"license.issued",JSON.stringify({ licenseId:license.id,planId,expiresAt:expiry.toISOString() })],
        );
        await client.query("COMMIT");
        return json(res, 201, { license });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (req.method === "PATCH") {
      const rawId = req.query.id;
      const id = Array.isArray(rawId) ? rawId[0] : rawId;
      const status = String(body.status ?? "");
      if (!id || !["active","suspended","revoked"].includes(status)) {
        return json(res, 400, { error: "وضعیت لایسنس معتبر نیست." });
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          "UPDATE licenses SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,user_id,expires_at",
          [id,status],
        );
        if (!updated.rowCount) {
          await client.query("ROLLBACK");
          return json(res, 404, { error: "لایسنس پیدا نشد." });
        }
        const license = updated.rows[0];
        if (license.user_id) {
          if (status === "active" && new Date(license.expires_at).getTime() > Date.now()) {
            await client.query(
              "UPDATE subscriptions SET starts_at=LEAST(starts_at,now()),expires_at=$2,license_id=$3,updated_at=now() WHERE user_id=$1",
              [license.user_id,license.expires_at,id],
            );
          } else {
            await client.query(
              "UPDATE subscriptions SET expires_at=now(),updated_at=now() WHERE user_id=$1 AND license_id=$2",
              [license.user_id,id],
            );
          }
          await client.query(
            "INSERT INTO audit_logs (actor_user_id,target_user_id,action,metadata) VALUES ($1,$2,$3,$4::jsonb)",
            [actor.id,license.user_id,"license.status_changed",JSON.stringify({ licenseId:id,status })],
          );
        }
        await client.query("COMMIT");
        return json(res, 200, { success:true });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("admin_licenses_error", error);
    return json(res, 500, { error: "عملیات لایسنس ناموفق بود." });
  }
}
