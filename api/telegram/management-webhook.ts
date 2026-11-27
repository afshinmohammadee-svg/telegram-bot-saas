import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, json, safeEqualHex, sha256, telegram } from "../_lib/server.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TgMessage = { chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgUpdate = { update_id: number; message?: TgMessage };

const adminKeyboard = {
  keyboard: [
    [{ text: "👥 مشتریان" }, { text: "📄 لایسنس‌ها" }],
    [{ text: "➕ راهنمای مدیر" }, { text: "ℹ️ راهنما" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "یک بخش مدیریتی را انتخاب کن",
};
const customerKeyboard = {
  keyboard: [
    [{ text: "📊 وضعیت لایسنس" }, { text: "🤖 ربات‌های من" }],
    [{ text: "⏸ توقف ربات" }, { text: "▶️ فعال‌سازی ربات" }],
    [{ text: "🔗 راهنمای اتصال" }, { text: "ℹ️ راهنما" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "یک گزینه را انتخاب کن",
};
const guestKeyboard = {
  keyboard: [[{ text: "ℹ️ راهنمای اتصال" }]],
  resize_keyboard: true,
  is_persistent: true,
};

function configuredAdminIds() {
  return new Set((process.env.PLATFORM_SUPERADMIN_TELEGRAM_IDS ?? "")
    .split(",").map((value) => value.trim()).filter((value) => /^\d+$/.test(value)));
}

async function send(token: string, chatId: number, text: string, keyboard?: Record<string, unknown>) {
  await telegram(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

function normalizeCommand(value: string) {
  return value.trim().replace(/@[A-Za-z0-9_]+$/, "").toLocaleLowerCase("fa");
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const token = process.env.MANAGEMENT_BOT_TOKEN;
  const webhookSecret = process.env.MANAGEMENT_BOT_WEBHOOK_SECRET;
  if (!token || !webhookSecret) return json(res, 503, { error: "Management bot is not configured" });
  const suppliedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (typeof suppliedSecret !== "string" || !safeEqualHex(sha256(suppliedSecret), sha256(webhookSecret))) {
    return json(res, 401, { error: "Unauthorized webhook" });
  }

  const update = (req.body && typeof req.body === "object" ? req.body : {}) as TgUpdate;
  const message = update.message;
  const from = message?.from;
  const chatId = message?.chat?.id;
  if (!message || !from || !chatId || message.chat.type !== "private" || from.is_bot) {
    return json(res, 200, { ok: true });
  }
  if (!Number.isSafeInteger(update.update_id)) return json(res, 200, { ok: true });

  let updateClaimed = false;
  try {
    const claim = await db.query(
      "INSERT INTO management_telegram_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id",
      [update.update_id],
    );
    if (!claim.rowCount) return json(res, 200, { ok: true, duplicate: true });
    updateClaimed = true;

    const telegramId = String(from.id);
    const rawText = (message.text ?? "").trim();
    const command = normalizeCommand(rawText);
    const startMatch = rawText.match(/^\/start(?:\s+([A-Za-z0-9_-]{16,64}))?/);
    const admin = configuredAdminIds().has(telegramId);

    if (startMatch?.[1]) {
      const challengeHash = sha256(startMatch[1]);
      const client = await db.connect();
      let linked = false;
      let identityConflict = false;
      try {
        await client.query("BEGIN");
        const challenge = await client.query(
          `SELECT id,user_id FROM telegram_link_challenges
            WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now()
            FOR UPDATE`,
          [challengeHash],
        );
        if (challenge.rowCount) {
          const account = await client.query(
            `INSERT INTO customer_telegram_accounts (user_id,telegram_user_id,telegram_username,last_seen_at)
             VALUES ($1,$2,$3,now())
             ON CONFLICT (telegram_user_id) DO UPDATE SET
               telegram_username=EXCLUDED.telegram_username,last_seen_at=now(),updated_at=now()
             WHERE customer_telegram_accounts.user_id=EXCLUDED.user_id
             RETURNING user_id`,
            [challenge.rows[0].user_id, telegramId, from.username ?? null],
          );
          if (!account.rowCount) {
            identityConflict = true;
            await client.query("ROLLBACK");
          } else {
            await client.query("UPDATE telegram_link_challenges SET consumed_at=now() WHERE id=$1", [challenge.rows[0].id]);
            await client.query("COMMIT");
            linked = true;
          }
        } else {
          await client.query("ROLLBACK");
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      if (identityConflict) {
        await send(token, chatId, "این حساب تلگرام قبلاً به حساب کاربری دیگری متصل شده است. برای حفظ امنیت، اتصال مجدد انجام نشد. با پشتیبانی تماس بگیر.");
      } else if (linked) {
        await send(token, chatId, "✅ اتصال حساب تلگرام با موفقیت تأیید شد.\nاز این پس می‌توانی وضعیت لایسنس و ربات‌های متعلق به حساب خودت را از همین‌جا مدیریت کنی.", customerKeyboard);
      } else {
        await send(token, chatId, "این لینک اتصال نامعتبر، منقضی یا قبلاً استفاده شده است. از پنل کاربری یک لینک تازه بساز.", guestKeyboard);
      }
      return json(res, 200, { ok: true });
    }

    if (admin) {
      if (["/start", "/admin", "👥 مشتریان", "/customers"].includes(command)) {
        if (["👥 مشتریان", "/customers"].includes(command)) {
          const result = await db.query(`SELECT count(*)::int AS total FROM "user" WHERE role<>'super_admin'`);
          await send(token, chatId, `👥 تعداد حساب‌های مشتری: ${result.rows[0].total}`, adminKeyboard);
        } else {
          await send(token, chatId, "🛡️ پنل مدیر کل پلتفرم\nاز دکمه‌های پایین برای مشاهده اطلاعات مدیریتی استفاده کن.", adminKeyboard);
        }
      } else if (["📄 لایسنس‌ها", "/licenses"].includes(command)) {
        const [near, expired] = await Promise.all([
          db.query(`SELECT count(*)::int AS total FROM licenses
            WHERE status='active' AND expires_at>now() AND expires_at<=now()+interval '30 days'`),
          db.query(`SELECT count(*)::int AS total FROM licenses
            WHERE expires_at<=now() AND status IN ('active','expired')`),
        ]);
        await send(token, chatId, `📄 گزارش لایسنس‌ها\n\n⏳ در آستانه انقضا (۳۰ روز): ${near.rows[0].total}\n⚠️ منقضی‌شده: ${expired.rows[0].total}\n\nصدور و تمدید لایسنس از پنل امن مدیر کل انجام می‌شود.`, adminKeyboard);
      } else if (["➕ راهنمای مدیر", "ℹ️ راهنما", "/help"].includes(command)) {
        await send(token, chatId, "راهنمای مدیر کل\n👥 مشتریان: تعداد حساب‌های مشتری\n📄 لایسنس‌ها: گزارش لایسنس‌های نزدیک به انقضا و منقضی‌شده\nتغییر یا صدور لایسنس فقط از پنل امن مدیر کل انجام می‌شود.", adminKeyboard);
      } else {
        await send(token, chatId, "از دکمه‌های پایین برای انتخاب بخش استفاده کن.", adminKeyboard);
      }
      return json(res, 200, { ok: true });
    }

    const account = await db.query(
      `SELECT u.id,u.name,u.email FROM customer_telegram_accounts a
        JOIN "user" u ON u.id=a.user_id WHERE a.telegram_user_id=$1 LIMIT 1`,
      [telegramId],
    );
    if (!account.rowCount) {
      await send(token, chatId, "برای استفاده از مدیریت تلگرامی، ابتدا وارد پنل تلگرام‌یار شو و حساب تلگرامت را با لینک یک‌بارمصرف متصل کن.\n\nاین اتصال فقط با زدن Start در لینک اختصاصی حساب خودت تأیید می‌شود.", guestKeyboard);
      return json(res, 200, { ok: true });
    }

    if (["/start", "/help", "ℹ️ راهنما"].includes(command)) {
      await send(token, chatId, `سلام ${account.rows[0].name}، به مدیریت تلگرام‌یار خوش آمدی.\nاز دکمه‌های پایین برای مدیریت حساب خودت استفاده کن.`, customerKeyboard);
    } else if (["/status", "📊 وضعیت لایسنس"].includes(command)) {
      const result = await db.query(
        `SELECT status,starts_at,expires_at FROM licenses
          WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [account.rows[0].id],
      );
      const license = result.rows[0];
      if (!license) await send(token, chatId, "برای این حساب هنوز لایسنسی صادر نشده است.", customerKeyboard);
      else await send(token, chatId, `📊 وضعیت لایسنس: ${license.status}\nشروع: ${license.starts_at ? new Date(license.starts_at).toLocaleDateString("fa-IR") : "—"}\nانقضا: ${license.expires_at ? new Date(license.expires_at).toLocaleDateString("fa-IR") : "—"}`, customerKeyboard);
    } else if (["/bots", "🤖 ربات‌های من"].includes(command)) {
      const result = await db.query(
        "SELECT name,username,status FROM bots WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",
        [account.rows[0].id],
      );
      const lines = result.rows.map((bot: {name:string;username:string|null;status:string}) =>
        `• ${bot.name}${bot.username ? " (@" + bot.username + ")" : ""} — ${bot.status}`);
      await send(token, chatId, lines.length ? "🤖 ربات‌های متعلق به حساب تو:\n" + lines.join("\n") : "هنوز رباتی برای این حساب ثبت نشده است.", customerKeyboard);
    } else if (["⏸ توقف ربات", "▶️ فعال‌سازی ربات"].includes(command)) {
      const owned = await db.query("SELECT id,username,status FROM bots WHERE owner_id=$1 LIMIT 1", [account.rows[0].id]);
      if (!owned.rowCount) {
        await send(token, chatId, "هنوز رباتی به حساب تو متصل نشده است.", customerKeyboard);
      } else if (command === "⏸ توقف ربات") {
        await db.query("UPDATE bots SET status='disabled',updated_at=now() WHERE id=$1 AND owner_id=$2", [owned.rows[0].id,account.rows[0].id]);
        await send(token, chatId, "⏸ ربات " + (owned.rows[0].username ? "@" + owned.rows[0].username : "") + " متوقف شد. اطلاعات و گفتگوهای قبلی حفظ شده‌اند. برای فعال‌سازی دوباره از همین منو استفاده کن.", customerKeyboard);
      } else {
        const activeLicense = await db.query("SELECT 1 FROM licenses WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now() LIMIT 1", [account.rows[0].id]);
        if (!activeLicense.rowCount) {
          await send(token, chatId, "برای فعال‌سازی ربات به لایسنس معتبر نیاز داری. لطفاً برای تمدید با مدیر پلتفرم هماهنگ کن.", customerKeyboard);
        } else {
          await db.query("UPDATE bots SET status='active',last_error=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2", [owned.rows[0].id,account.rows[0].id]);
          await send(token, chatId, "▶️ ربات فعال شد. پیام‌های جدید دوباره پردازش می‌شوند.", customerKeyboard);
        }
      }
    } else if (["🔗 راهنمای اتصال"].includes(command)) {
      await send(token, chatId, "برای اتصال حساب یا مدیریت اطلاعات ورود، وارد پنل وب تلگرام‌یار شو و از بخش تنظیمات، گزینه اتصال تلگرام را انتخاب کن. لینک اتصال یک‌بارمصرف است و فقط ۱۰ دقیقه اعتبار دارد.", customerKeyboard);
    } else {
      await send(token, chatId, "از دکمه‌های پایین برای انتخاب بخش استفاده کن.", customerKeyboard);
    }
    await db.query("UPDATE customer_telegram_accounts SET last_seen_at=now(),telegram_username=$2,updated_at=now() WHERE telegram_user_id=$1", [telegramId, from.username ?? null]);
    return json(res, 200, { ok: true });
  } catch (error) {
    if (updateClaimed) {
      await db.query("DELETE FROM management_telegram_updates WHERE update_id=$1", [update.update_id]).catch(() => undefined);
    }
    console.error("management_telegram_webhook_error", error);
    return json(res, 500, { ok: false });
  }
}
