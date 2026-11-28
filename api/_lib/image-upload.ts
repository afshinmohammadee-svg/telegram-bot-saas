import type { ApiRequest, ApiResponse } from "./server.js";
import { bodyOf, db, json, ownedBot, requireUser } from "./server.js";
import { deleteImage, putImage } from "./object-storage.js";
import { imageSha256, isLegacyTelegramPhoto, MAX_IMAGES_PER_BOT, newImageKey, validateImage } from "./image-assets.js";

function isObjectKey(value: unknown): value is string {
  return typeof value === "string" && /^bots\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(value);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const bot = await ownedBot(user.id);
    if (!bot) return json(res, 409, { error: "ابتدا ربات تلگرام خود را متصل کن." });
    const license = await db.query(
      "SELECT features_snapshot FROM licenses WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
      [user.id],
    );
    if (license.rows[0]?.features_snapshot?.menuBuilder !== true)
      return json(res, 403, { error: "امکان مدیریت تصویر در لایسنس شما فعال نیست." });
    if (req.method !== "POST" && req.method !== "DELETE") return json(res, 405, { error: "Method not allowed" });

    const body = bodyOf(req);
    const kind = body.kind === "banner" ? "banner" : body.kind === "menu" ? "menu" : null;
    const menuId = kind === "menu" ? String(body.menuId ?? "") : null;
    if (!kind || (kind === "menu" && !menuId)) return json(res, 400, { error: "نوع تصویر یا شناسه منو معتبر نیست." });
    if (kind === "menu") {
      const ownedMenu = await db.query("SELECT id FROM bot_menus WHERE id=$1 AND bot_id=$2", [menuId, bot.id]);
      if (!ownedMenu.rowCount) return json(res, 404, { error: "منو پیدا نشد." });
    }
    if (req.method === "DELETE") {
      let client;
  try { client = await db.connect(); } catch (error) { await deleteImage(key).catch(() => undefined); throw error; }
      let oldKey: string | null = null;
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM bots WHERE id=$1 AND owner_id=$2 FOR UPDATE", [bot.id, user.id]);
        const oldRef = kind === "banner"
          ? await client.query("SELECT banner_file_id AS ref FROM bot_menu_appearance WHERE bot_id=$1 FOR UPDATE", [bot.id])
          : await client.query("SELECT response_content AS ref FROM bot_menus WHERE id=$1 AND bot_id=$2 FOR UPDATE", [menuId, bot.id]);
        const oldValue = oldRef.rows[0]?.ref ?? null;
        if (isObjectKey(oldValue) && oldValue.startsWith(`bots/${bot.id}/images/`)) oldKey = oldValue;
        if (kind === "banner") {
          await client.query("UPDATE bot_menu_appearance SET banner_file_id=NULL,updated_at=now() WHERE bot_id=$1", [bot.id]);
        } else {
          await client.query("UPDATE bot_menus SET response_type='text',response_content=NULL,payload=title,updated_at=now() WHERE id=$1 AND bot_id=$2", [menuId, bot.id]);
        }
        if (oldKey) await client.query("DELETE FROM bot_images WHERE bot_id=$1 AND object_key=$2", [bot.id, oldKey]);
        await client.query("COMMIT");
      } catch {
        await client.query("ROLLBACK");
        throw new Error("حذف تصویر ناموفق بود.");
      } finally {
        client.release();
      }
      if (oldKey) await deleteImage(oldKey).catch(() => undefined);
      return json(res, 200, { success: true });
    }

    const encoded = String(body.imageBase64 ?? "");
    if (!encoded || encoded.length > 420_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      return json(res, 400, { error: "داده تصویر معتبر نیست یا بیش از حد بزرگ است." });
    const bytes = Buffer.from(encoded, "base64");
    const detected = validateImage(bytes);
    const key = newImageKey(bot.id, detected.extension);
    await putImage(key, bytes, detected.mimeType);

    let oldKey: string | null = null;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM bots WHERE id=$1 AND owner_id=$2 FOR UPDATE", [bot.id, user.id]);
      const oldRef = kind === "banner"
        ? await client.query("SELECT banner_file_id AS ref FROM bot_menu_appearance WHERE bot_id=$1 FOR UPDATE", [bot.id])
        : await client.query("SELECT response_content AS ref FROM bot_menus WHERE id=$1 AND bot_id=$2 FOR UPDATE", [menuId, bot.id]);
      const oldValue = oldRef.rows[0]?.ref ?? null;
      if (isObjectKey(oldValue) && oldValue.startsWith(`bots/${bot.id}/images/`)) oldKey = oldValue;

      const quota = await client.query(
        `SELECT
           (SELECT count(*)::int FROM bot_images WHERE bot_id=$1 AND status='active') AS stored_count,
           (SELECT count(*)::int FROM bot_menu_appearance WHERE bot_id=$1 AND banner_file_id LIKE 'tgphoto:%') +
           (SELECT count(*)::int FROM bot_menus WHERE bot_id=$1 AND response_type='photo' AND response_content LIKE 'tgphoto:%') AS legacy_count`,
        [bot.id],
      );
      const replacingExisting = typeof oldValue === "string" && (isObjectKey(oldValue) || isLegacyTelegramPhoto(oldValue));
      const total = Number(quota.rows[0].stored_count) + Number(quota.rows[0].legacy_count);
      if (!replacingExisting && total >= MAX_IMAGES_PER_BOT) throw new Error("سقف ۵ تصویر برای این ربات تکمیل شده است.");

      if (oldKey) await client.query("DELETE FROM bot_images WHERE bot_id=$1 AND object_key=$2", [bot.id, oldKey]);
      await client.query(
        "INSERT INTO bot_images(bot_id,kind,menu_id,object_key,mime_type,size_bytes,sha256,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active')",
        [bot.id, kind, menuId, key, detected.mimeType, bytes.length, imageSha256(bytes)],
      );
      if (kind === "banner") {
        await client.query(
          `INSERT INTO bot_menu_appearance(bot_id,banner_file_id) VALUES($1,$2)
           ON CONFLICT(bot_id) DO UPDATE SET banner_file_id=EXCLUDED.banner_file_id,updated_at=now()`,
          [bot.id, key],
        );
      } else {
        await client.query(
          "UPDATE bot_menus SET response_type='photo',response_content=$3,payload=$3,updated_at=now() WHERE id=$1 AND bot_id=$2",
          [menuId, bot.id, key],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await deleteImage(key).catch(() => undefined);
      if (error instanceof Error && error.message.startsWith("سقف ۵")) return json(res, 403, { error: error.message });
      throw error;
    } finally {
      client.release();
    }

    if (oldKey) await deleteImage(oldKey).catch(() => undefined);
    return json(res, 200, { success: true, imageKey: key, mimeType: detected.mimeType, sizeBytes: bytes.length });
  } catch {
    return json(res, 500, { error: "بارگذاری تصویر ناموفق بود. تنظیمات ذخیره‌سازی را بررسی کنید." });
  }
}
