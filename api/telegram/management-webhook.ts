import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, decryptToken, json, safeEqualHex, sha256, telegram } from "../_lib/server.js";
import { deleteImage, putImage } from "../_lib/object-storage.js";
import { imageSha256, isLegacyTelegramPhoto, newImageKey, validateImage } from "../_lib/image-assets.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TgMessage = { message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; caption?: string; reply_to_message?: { message_id:number }; photo?: Array<{file_id:string;file_unique_id:string;width:number;height:number}>; contact?: { phone_number: string; user_id?: number } };
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
    [{ text: "🧩 مدیریت منو" }],
    [{ text: "⏸ توقف ربات" }, { text: "▶️ فعال‌سازی ربات" }],
    [{ text: "📱 تأیید شماره موبایل", request_contact: true }],
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

async function downloadPhotoFromManagementBot(token: string, fileId: string): Promise<Buffer> {
  const file = await telegram<{file_path?:string}>(token, "getFile", {file_id:fileId});
  if (!file.file_path) throw new Error("Telegram photo path is unavailable");
  const response = await fetch("https://api.telegram.org/file/bot" + token + "/" + file.file_path);
  if (!response.ok) throw new Error("Could not download management photo");
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 300 * 1024) throw new Error("Photo exceeds 300 KiB limit");
  const bytes = Buffer.from(await response.arrayBuffer());
  validateImage(bytes);
  return bytes;
}

function isManagedImageKey(value: unknown, botId: string): value is string {
  return typeof value === "string" && value.startsWith("bots/" + botId + "/images/") && /^bots\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(value);
}

async function persistManagedImage(botId: string, kind: "banner" | "menu", menuId: string | null, bytes: Buffer) {
  const detected = validateImage(bytes);
  const key = newImageKey(botId, detected.extension);
  await putImage(key, bytes, detected.mimeType);
  let client;\n  try { client = await db.connect(); } catch (error) { await deleteImage(key).catch(() => undefined); throw error; }
  let oldKey: string | null = null;
  try {
    await client.query("BEGIN");
    const bot = await client.query("SELECT id FROM bots WHERE id=$1 FOR UPDATE", [botId]);
    if (!bot.rowCount) throw new Error("Managed bot no longer exists");
    const oldRef = kind === "banner"
      ? await client.query("SELECT banner_file_id AS ref FROM bot_menu_appearance WHERE bot_id=$1 FOR UPDATE", [botId])
      : await client.query("SELECT response_content AS ref FROM bot_menus WHERE id=$1 AND bot_id=$2 FOR UPDATE", [menuId, botId]);
    if (kind === "menu" && !oldRef.rowCount) throw new Error("Menu no longer exists");
    const oldValue = oldRef.rows[0]?.ref ?? null;
    if (isManagedImageKey(oldValue, botId)) oldKey = oldValue;
    const quota = await client.query("SELECT (SELECT count(*)::int FROM bot_images WHERE bot_id=$1 AND status='active') AS stored_count, (SELECT count(*)::int FROM bot_menu_appearance WHERE bot_id=$1 AND banner_file_id LIKE 'tgphoto:%') + (SELECT count(*)::int FROM bot_menus WHERE bot_id=$1 AND response_type='photo' AND response_content LIKE 'tgphoto:%') AS legacy_count", [botId]);
    const replacing = isManagedImageKey(oldValue, botId) || isLegacyTelegramPhoto(oldValue);
    const total = Number(quota.rows[0].stored_count) + Number(quota.rows[0].legacy_count);
    if (!replacing && total >= 5) throw new Error("IMAGE_QUOTA_EXCEEDED");
    if (oldKey) await client.query("DELETE FROM bot_images WHERE bot_id=$1 AND object_key=$2", [botId, oldKey]);
    await client.query("INSERT INTO bot_images(bot_id,kind,menu_id,object_key,mime_type,size_bytes,sha256,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active')", [botId, kind, menuId, key, detected.mimeType, bytes.length, imageSha256(bytes)]);
    if (kind === "banner") {
      await client.query("INSERT INTO bot_menu_appearance(bot_id,banner_file_id) VALUES($1,$2) ON CONFLICT(bot_id) DO UPDATE SET banner_file_id=EXCLUDED.banner_file_id,updated_at=now()", [botId, key]);
    } else {
      await client.query("UPDATE bot_menus SET response_type='photo',response_content=$3,payload=$3,is_active=true,updated_at=now() WHERE id=$1 AND bot_id=$2", [menuId, botId, key]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await deleteImage(key).catch(() => undefined);
    throw error;
  } finally { client.release(); }
  if (oldKey) await deleteImage(oldKey).catch(() => undefined);
  return key;
}

async function removeManagedImage(botId: string, kind: "banner" | "menu", menuId: string | null) {
  const client = await db.connect();
  let oldKey: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM bots WHERE id=$1 FOR UPDATE", [botId]);
    const oldRef = kind === "banner"
      ? await client.query("SELECT banner_file_id AS ref FROM bot_menu_appearance WHERE bot_id=$1 FOR UPDATE", [botId])
      : await client.query("SELECT response_content AS ref FROM bot_menus WHERE id=$1 AND bot_id=$2 FOR UPDATE", [menuId, botId]);
    const oldValue = oldRef.rows[0]?.ref ?? null;
    if (isManagedImageKey(oldValue, botId)) oldKey = oldValue;
    if (kind === "banner") await client.query("UPDATE bot_menu_appearance SET banner_file_id=NULL,updated_at=now() WHERE bot_id=$1", [botId]);
    else await client.query("UPDATE bot_menus SET response_type='text',response_content=NULL,payload=title,updated_at=now() WHERE id=$1 AND bot_id=$2", [menuId, botId]);
    if (oldKey) await client.query("DELETE FROM bot_images WHERE bot_id=$1 AND object_key=$2", [botId, oldKey]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  if (oldKey) await deleteImage(oldKey).catch(() => undefined);
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
    if (message.reply_to_message?.message_id && account.rowCount) {
      const mapping = await db.query(
        `SELECT f.bot_id,f.owner_user_id,f.visitor_chat_id,f.conversation_id,b.display_name,s.encrypted_token
           FROM visitor_message_forward_map f
           JOIN bots b ON b.id=f.bot_id AND b.owner_id=f.owner_user_id AND b.status='active'
           JOIN bot_secrets s ON s.bot_id=b.id
          WHERE f.management_message_id=$1 AND f.management_chat_id=$2 AND f.owner_user_id=$3
          LIMIT 1`,
        [message.reply_to_message.message_id,chatId,account.rows[0].id],
      );
      if (mapping.rowCount) {
        const replyText = (message.text ?? message.caption ?? "").trim().slice(0,4096);
        if (!replyText) {
          await send(token,chatId,"برای پاسخ به بازدیدکننده، لطفاً متن پیام را ارسال کن.");
          return json(res,200,{ok:true});
        }
        const customerToken = decryptToken(mapping.rows[0].encrypted_token);
        const delivered = await telegram<{message_id:number}>(customerToken,"sendMessage",{chat_id:mapping.rows[0].visitor_chat_id,text:replyText});
        await db.query(
          "INSERT INTO messages(conversation_id,telegram_message_id,direction,sender_type,text_body,delivery_status,sent_at) VALUES($1,$2,'outbound','bot_owner',$3,'sent',now())",
          [mapping.rows[0].conversation_id,delivered.message_id,replyText],
        );
        await db.query("UPDATE conversations SET last_message_at=now(),status='open',updated_at=now() WHERE id=$1",[mapping.rows[0].conversation_id]);
        await send(token,chatId,"✅ پاسخ از طریق ربات «"+String(mapping.rows[0].display_name||"مشتری") + "» برای بازدیدکننده ارسال شد.",customerKeyboard);
        return json(res,200,{ok:true,replied:true});
      }
    }

    if (!account.rowCount) {
      await send(token, chatId, "برای استفاده از مدیریت تلگرامی، ابتدا وارد پنل تلگرام‌یار شو و حساب تلگرامت را با لینک یک‌بارمصرف متصل کن.\n\nاین اتصال فقط با زدن Start در لینک اختصاصی حساب خودت تأیید می‌شود.", guestKeyboard);
      return json(res, 200, { ok: true });
    }

    if (message.contact) {
      if (message.contact.user_id !== from.id) {
        await send(token, chatId, "برای تأیید شماره، باید مخاطب شماره تلفن خودت را از دکمه اشتراک‌گذاری ارسال کنی.", customerKeyboard);
      } else {
        const phone = message.contact.phone_number.replace(/[^+0-9]/g, "").slice(0, 20);
        await db.query(
          "UPDATE customer_telegram_accounts SET phone_number=$2,phone_verified_at=now(),last_seen_at=now(),updated_at=now() WHERE telegram_user_id=$1",
          [telegramId, phone],
        );
        await send(token, chatId, "✅ شماره موبایل خودت با موفقیت تأیید و به حساب متصل شد.", customerKeyboard);
      }
      return json(res, 200, { ok: true });
    }

    const rawInput = (message.text ?? "").trim();
    const photoFileId = message.photo?.[message.photo.length - 1]?.file_id ?? null;
    const getPhotoBytes = async () => photoFileId ? downloadPhotoFromManagementBot(token, photoFileId) : null;
    const mediaCaption = (message.caption ?? "").trim().slice(0, 1000);
    const menuManagerButton = "🧩 مدیریت منو";
    const menuLicense = await db.query(
      `SELECT features_snapshot FROM licenses WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now() ORDER BY expires_at DESC LIMIT 1`,
      [account.rows[0].id],
    );
    const menuAllowed = menuLicense.rows[0]?.features_snapshot?.menuBuilder === true;

    if (rawInput === menuManagerButton) {
      if (!menuAllowed) {
        await send(token,chatId,"امکان مدیریت منو از ربات مرکزی در لایسنس فعلی شما فعال نیست. برای فعال‌سازی با مدیر پلتفرم تماس بگیرید.",customerKeyboard);
        return json(res,200,{ok:true});
      }
      const owned = await db.query("SELECT id,display_name,username FROM bots WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20",[account.rows[0].id]);
      if (!owned.rowCount) {
        await send(token,chatId,"هنوز رباتی به حساب شما متصل نشده است. ابتدا ربات خود را از پنل کاربری متصل کنید.",customerKeyboard);
      } else if (owned.rowCount === 1) {
        await db.query(`INSERT INTO management_menu_sessions(telegram_user_id,user_id,bot_id,step,draft,updated_at) VALUES($1,$2,$3,'home','{}'::jsonb,now()) ON CONFLICT(telegram_user_id) DO UPDATE SET user_id=EXCLUDED.user_id,bot_id=EXCLUDED.bot_id,step='home',draft='{}'::jsonb,updated_at=now()`,[telegramId,account.rows[0].id,owned.rows[0].id]);
        await send(token,chatId,"🧩 مدیریت منوی ربات شما\nاز گزینه‌های زیر برای ثبت یا ویرایش منو و بنر استفاده کنید.",{keyboard:[[{text:"➕ گزینه اصلی جدید"},{text:"➕ زیرمنوی جدید"}],[{text:"✏️ ویرایش منو"},{text:"📋 فهرست منوها"}],[{text:"🖼 تنظیم بنر"},{text:"🗑 حذف بنر"}],[{text:"⬅️ بازگشت به پنل"}]],resize_keyboard:true,is_persistent:true});
      } else {
        await db.query(`INSERT INTO management_menu_sessions(telegram_user_id,user_id,bot_id,step,draft,updated_at) VALUES($1,$2,NULL,'choose_bot','{}'::jsonb,now()) ON CONFLICT(telegram_user_id) DO UPDATE SET user_id=EXCLUDED.user_id,bot_id=NULL,step='choose_bot',draft='{}'::jsonb,updated_at=now()`,[telegramId,account.rows[0].id]);
        const buttons = owned.rows.map((b:{display_name:string|null;username:string|null})=>[{text:"🤖 "+(b.username?"@"+b.username:b.display_name||"ربات تلگرام")}]);
        await send(token,chatId,"کدام ربات را می‌خواهید مدیریت کنید؟",{keyboard:buttons,resize_keyboard:true,is_persistent:true});
      }
      return json(res,200,{ok:true});
    }

    const menuSessionResult = await db.query(
      "SELECT bot_id,step,draft FROM management_menu_sessions WHERE telegram_user_id=$1 AND user_id=$2 LIMIT 1",
      [telegramId,account.rows[0].id],
    );
    const menuSession = menuSessionResult.rows[0];
    if (menuSession && rawInput !== "/cancel") {
      if (!menuAllowed) {
        await db.query("DELETE FROM management_menu_sessions WHERE telegram_user_id=$1",[telegramId]);
        await send(token,chatId,"دسترسی مدیریت منو در لایسنس شما فعال نیست.",customerKeyboard);
        return json(res,200,{ok:true});
      }
      let draft = (menuSession.draft ?? {}) as Record<string,any>;
      let botId = menuSession.bot_id as string|null;
      const saveSession = async (step:string,nextDraft:Record<string,any>,nextBotId=botId) => {
        await db.query("UPDATE management_menu_sessions SET bot_id=$3,step=$4,draft=$5::jsonb,updated_at=now() WHERE telegram_user_id=$1 AND user_id=$2",[telegramId,account.rows[0].id,nextBotId,step,JSON.stringify(nextDraft)]);
      };
      const homeKeyboard = {keyboard:[[{text:"➕ گزینه اصلی جدید"},{text:"➕ زیرمنوی جدید"}],[{text:"✏️ ویرایش منو"},{text:"📋 فهرست منوها"}],[{text:"🖼 تنظیم بنر"},{text:"🗑 حذف بنر"}],[{text:"⬅️ بازگشت به پنل"}]],resize_keyboard:true,is_persistent:true};
      if (menuSession.step === "choose_bot") {
        const owned = await db.query("SELECT id,display_name,username FROM bots WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 20",[account.rows[0].id]);
        const selected = owned.rows.find((b:{display_name:string|null;username:string|null})=>"🤖 "+(b.username?"@"+b.username:b.display_name||"ربات تلگرام")===rawInput);
        if (!selected) { await send(token,chatId,"لطفاً یکی از ربات‌های نمایش‌داده‌شده را انتخاب کنید."); return json(res,200,{ok:true}); }
        botId=selected.id;
        await saveSession("home",{},botId);
        await send(token,chatId,"ربات انتخاب شد. عملیات موردنظر را انتخاب کنید.",homeKeyboard);
        return json(res,200,{ok:true});
      }
      if (!botId) {
        await db.query("DELETE FROM management_menu_sessions WHERE telegram_user_id=$1",[telegramId]);
        await send(token,chatId,"نشست مدیریت منو منقضی شد. دوباره «مدیریت منو» را انتخاب کنید.",customerKeyboard);
        return json(res,200,{ok:true});
      }
      if (rawInput === "⬅️ بازگشت به پنل") {
        await db.query("DELETE FROM management_menu_sessions WHERE telegram_user_id=$1",[telegramId]);
        await send(token,chatId,"به پنل مدیریت حساب برگشتید.",customerKeyboard);
        return json(res,200,{ok:true});
      }
      if (rawInput === "📋 فهرست منوها") {
        const menus=await db.query("SELECT title,parent_id,response_type,is_active FROM bot_menus WHERE bot_id=$1 ORDER BY parent_id NULLS FIRST,sort_order,title LIMIT 80",[botId]);
        const lines=menus.rows.map((m:{title:string;parent_id:string|null;response_type:string;is_active:boolean})=>(m.parent_id?"  ↳ ":"• ")+m.title+" ["+m.response_type+"]"+(m.is_active?"":" (غیرفعال)"));
        await send(token,chatId,lines.length?"📋 منوهای ثبت‌شده:\n"+lines.join("\n"):"هنوز منویی ثبت نشده است.",homeKeyboard);
        return json(res,200,{ok:true});
      }
      if (rawInput === "🖼 تنظیم بنر") { await saveSession("banner_wait",{}); await send(token,chatId,"عکس بنر صفحه اصلی را همین‌جا ارسال کن. متن روی بنر از بخش «متن خوشامدگویی» در پنل تنظیم می‌شود؛ برای لغو /cancel را بفرست."); return json(res,200,{ok:true}); }
      if (rawInput === "🗑 حذف بنر") { await removeManagedImage(botId,"banner",null); await saveSession("home",{},botId); await send(token,chatId,"بنر صفحه اصلی حذف شد.",homeKeyboard); return json(res,200,{ok:true}); }
      if (rawInput === "➕ گزینه اصلی جدید") {
        await saveSession("add_title",{parentId:null});
        await send(token,chatId,"عنوان گزینه اصلی را ارسال کنید (حداکثر ۱۲۰ نویسه). برای لغو /cancel را بفرستید.");
        return json(res,200,{ok:true});
      }
      if (rawInput === "➕ زیرمنوی جدید") {
        const parents=await db.query("SELECT id,title FROM bot_menus WHERE bot_id=$1 AND is_active=true ORDER BY sort_order,title LIMIT 60",[botId]);
        if(!parents.rowCount){await send(token,chatId,"ابتدا یک گزینه اصلی ایجاد کنید.",homeKeyboard);return json(res,200,{ok:true});}
        await saveSession("submenu_parent",{});
        await send(token,chatId,"گزینه والد زیرمنوی جدید را انتخاب کنید.",{keyboard:parents.rows.map((m:{title:string})=>[{text:m.title}]),resize_keyboard:true,is_persistent:true});
        return json(res,200,{ok:true});
      }
      if (rawInput === "✏️ ویرایش منو") {
        const menus=await db.query("SELECT id,title,parent_id FROM bot_menus WHERE bot_id=$1 AND is_active=true ORDER BY sort_order,title LIMIT 60",[botId]);
        if(!menus.rowCount){await send(token,chatId,"هنوز منویی برای ویرایش وجود ندارد.",homeKeyboard);return json(res,200,{ok:true});}
        await saveSession("edit_pick",{});
        await send(token,chatId,"گزینه موردنظر برای ویرایش را انتخاب کنید.",{keyboard:menus.rows.map((m:{title:string;parent_id:string|null})=>[{text:(m.parent_id?"↳ ":"")+m.title}]),resize_keyboard:true,is_persistent:true});
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "submenu_parent") {
        const parents=await db.query("SELECT id,title FROM bot_menus WHERE bot_id=$1 AND is_active=true ORDER BY sort_order,title LIMIT 60",[botId]);
        const parent=parents.rows.find((m:{title:string})=>m.title===rawInput);
        if(!parent){await send(token,chatId,"لطفاً یکی از گزینه‌های والد را انتخاب کنید.");return json(res,200,{ok:true});}
        await saveSession("add_title",{parentId:parent.id});
        await send(token,chatId,"عنوان زیرمنوی جدید را ارسال کنید.");
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "add_title") {
        const title=rawInput.trim().slice(0,120);
        if(!title){await send(token,chatId,"عنوان نمی‌تواند خالی باشد. دوباره ارسال کنید.");return json(res,200,{ok:true});}
        await saveSession("add_type",{...draft,title});
        await send(token,chatId,"نوع گزینه را انتخاب کنید.",{keyboard:[[{text:"📝 متن"},{text:"📂 زیرمنو"}],[{text:"🖼 عکس"},{text:"📎 فایل"}],[{text:"🔗 لینک"},{text:"⬅️ بازگشت به پنل"}]],resize_keyboard:true,is_persistent:true});
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "add_type") {
        const types:Record<string,string>={"📝 متن":"text","📂 زیرمنو":"submenu","🖼 عکس":"photo","📎 فایل":"document","🔗 لینک":"url"};
        const responseType=types[rawInput];
        if(!responseType){await send(token,chatId,"یکی از نوع‌های نمایش‌داده‌شده را انتخاب کنید.");return json(res,200,{ok:true});}
        if(responseType==="submenu"){
          await db.query("INSERT INTO bot_menus(bot_id,title,payload,parent_id,response_type,is_active) VALUES($1,$2,$2,$3,'submenu',true)",[botId,draft.title,draft.parentId??null]);
          await saveSession("home",{},botId);
          await send(token,chatId,"✅ زیرمنو ثبت شد.",homeKeyboard);
        } else {
          await saveSession("add_content",{...draft,responseType});
          await send(token,chatId,responseType==="url"?"لینک کامل با https:// را ارسال کنید.":responseType==="photo"?"خودِ عکس را ارسال کن؛ در صورت نیاز توضیح را در کپشن عکس بنویس.":responseType==="document"?"شناسه فایل سند تلگرام (file_id) را ارسال کنید.":"متن پاسخ این گزینه را ارسال کنید.");
        }
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "banner_wait") {
        const photoBytes = await getPhotoBytes();
        if (!photoBytes) { await send(token,chatId,"لطفاً خودِ تصویر را به‌صورت Photo ارسال کن؛ ارسال متن یا فایل به‌جای عکس پذیرفته نیست."); return json(res,200,{ok:true}); }
        try { await persistManagedImage(botId,"banner",null,photoBytes); }
        catch (error) {
          if (error instanceof Error && error.message === "IMAGE_QUOTA_EXCEEDED") {
            await send(token,chatId,"سقف ۵ تصویر برای این ربات تکمیل شده است. ابتدا یکی از تصاویر قبلی را حذف کنید.",homeKeyboard);
            return json(res,200,{ok:true});
          }
          throw error;
        }
        await saveSession("home",{},botId);
        await send(token,chatId,"✅ بنر صفحه اصلی در فضای ذخیره‌سازی امن ثبت شد.",homeKeyboard);
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "add_content") {
        const type = menuSession.draft?.responseType;
        if (type === "photo") {
          const photoBytes = await getPhotoBytes();
          if (!photoBytes) { await send(token,chatId,"لطفاً خودِ عکس را ارسال کن و در صورت نیاز توضیح را در کپشن بنویس."); return json(res,200,{ok:true}); }
          const inserted = await db.query("INSERT INTO bot_menus(bot_id,title,payload,description,parent_id,response_type,response_content,target_url,is_active) VALUES($1,$2,$3,$4,$5,'photo',NULL,NULL,false) RETURNING id", [botId,draft.title,"",mediaCaption||null,draft.parentId??null]);
          try { await persistManagedImage(botId,"menu",inserted.rows[0].id,photoBytes); }
          catch (error) {
            await db.query("DELETE FROM bot_menus WHERE id=$1 AND bot_id=$2",[inserted.rows[0].id,botId]);
            if (error instanceof Error && error.message === "IMAGE_QUOTA_EXCEEDED") {
              await send(token,chatId,"سقف ۵ تصویر برای این ربات تکمیل شده است. ابتدا یکی از تصاویر قبلی را حذف کنید.",homeKeyboard);
              return json(res,200,{ok:true});
            }
            throw error;
          }
        } else {
          const value=rawInput.trim().slice(0,15000000);
          if(type==="url"&&!/^https:\/\//i.test(value)){await send(token,chatId,"لینک باید با https:// شروع شود. دوباره ارسال کنید.");return json(res,200,{ok:true});}
          await db.query("INSERT INTO bot_menus(bot_id,title,payload,description,parent_id,response_type,response_content,target_url,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)",[botId,draft.title,value,null,draft.parentId??null,type,type==="url"?null:value,type==="url"?value:null]);
        }
        await saveSession("home",{},botId);
        await send(token,chatId,"✅ گزینه منو با موفقیت ثبت شد.",homeKeyboard);
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "edit_pick") {
        const menus=await db.query("SELECT id,title,parent_id FROM bot_menus WHERE bot_id=$1 AND is_active=true ORDER BY sort_order,title LIMIT 60",[botId]);
        const selected=menus.rows.find((m:{title:string;parent_id:string|null})=>(m.parent_id?"↳ ":"")+m.title===rawInput);
        if(!selected){await send(token,chatId,"لطفاً یکی از منوهای فهرست را انتخاب کنید.");return json(res,200,{ok:true});}
        await saveSession("edit_action",{menuId:selected.id});
        await send(token,chatId,"چه تغییری اعمال شود؟",{keyboard:[[{text:"✏️ تغییر عنوان"},{text:"📝 تغییر پاسخ"}],[{text:"⏸ غیرفعال‌سازی گزینه"},{text:"⬅️ بازگشت به پنل"}]],resize_keyboard:true,is_persistent:true});
        return json(res,200,{ok:true});
      }
      if (menuSession.step === "edit_action") {
        if(rawInput==="✏️ تغییر عنوان"){await saveSession("edit_title",draft);await send(token,chatId,"عنوان جدید را ارسال کنید.");return json(res,200,{ok:true});}
        if(rawInput==="📝 تغییر پاسخ"){await saveSession("edit_content",draft);await send(token,chatId,"پاسخ جدید یا file_id رسانه را ارسال کنید.");return json(res,200,{ok:true});}
        if(rawInput==="⏸ غیرفعال‌سازی گزینه"){await db.query("UPDATE bot_menus SET is_active=false,updated_at=now() WHERE id=$1 AND bot_id=$2",[draft.menuId,botId]);await saveSession("home",{},botId);await send(token,chatId,"گزینه منو غیرفعال شد.",homeKeyboard);return json(res,200,{ok:true});}
        await send(token,chatId,"یکی از عملیات نمایش‌داده‌شده را انتخاب کنید.");return json(res,200,{ok:true});
      }
      if (menuSession.step === "edit_title") {
        await db.query("UPDATE bot_menus SET title=$3,payload=CASE WHEN response_type='text' THEN $3 ELSE payload END,updated_at=now() WHERE id=$1 AND bot_id=$2",[draft.menuId,botId,rawInput.trim().slice(0,120)]);
        await saveSession("home",{},botId);await send(token,chatId,"✅ عنوان منو تغییر کرد.",homeKeyboard);return json(res,200,{ok:true});
      }
      if (menuSession.step === "edit_content") {
        const current=await db.query("SELECT response_type FROM bot_menus WHERE id=$1 AND bot_id=$2",[draft.menuId,botId]);
        const type=current.rows[0]?.response_type;
        if (type === "photo") {
          const photoBytes = await getPhotoBytes();
          if (!photoBytes) { await send(token,chatId,"لطفاً عکس جدید را ارسال کن و توضیح را در کپشن بنویس."); return json(res,200,{ok:true}); }
          try { await persistManagedImage(botId,"menu",draft.menuId,photoBytes); }
          catch (error) {
            if (error instanceof Error && error.message === "IMAGE_QUOTA_EXCEEDED") {
              await send(token,chatId,"سقف ۵ تصویر برای این ربات تکمیل شده است.",homeKeyboard);
              return json(res,200,{ok:true});
            }
            throw error;
          }
          await db.query("UPDATE bot_menus SET description=$3,updated_at=now() WHERE id=$1 AND bot_id=$2",[draft.menuId,botId,mediaCaption||null]);
        } else {
          const value=rawInput.trim().slice(0,15000000);
          if(type==="url"&&!/^https:\/\//i.test(value)){await send(token,chatId,"لینک باید با https:// شروع شود.");return json(res,200,{ok:true});}
          await db.query("UPDATE bot_menus SET response_content=CASE WHEN $3='url' THEN response_content ELSE $4 END,target_url=CASE WHEN $3='url' THEN $4 ELSE target_url END,payload=$4,updated_at=now() WHERE id=$1 AND bot_id=$2",[draft.menuId,botId,type,value]);
        }
        await saveSession("home",{},botId);await send(token,chatId,"✅ پاسخ گزینه به‌روزرسانی شد.",homeKeyboard);return json(res,200,{ok:true});
      }
      await send(token,chatId,"از گزینه‌های مدیریت منو استفاده کنید.",homeKeyboard);
      return json(res,200,{ok:true});
    }
    if (rawInput === "/cancel") {
      await db.query("DELETE FROM management_menu_sessions WHERE telegram_user_id=$1",[telegramId]);
      await send(token,chatId,"عملیات مدیریت منو لغو شد.",customerKeyboard);
      return json(res,200,{ok:true});
    }

    if (["/start", "/help", "ℹ️ راهنما"].includes(command)) {
      await send(token, chatId, `سلام ${account.rows[0].name}، به مدیریت تلگرام‌یار خوش آمدی.\nاز دکمه‌های پایین برای مدیریت حساب خودت استفاده کن.`, customerKeyboard);
    } else if (["/status", "📊 وضعیت لایسنس"].includes(command)) {
      const result = await db.query(
        `SELECT CASE WHEN status='active' AND expires_at<=now() THEN 'expired' ELSE status END AS status,starts_at,expires_at FROM licenses
          WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,
        [account.rows[0].id],
      );
      const license = result.rows[0];
      if (!license) await send(token, chatId, "برای این حساب هنوز لایسنسی صادر نشده است.", customerKeyboard);
      else await send(token, chatId, `📊 وضعیت لایسنس: ${license.status}\nشروع: ${license.starts_at ? new Date(license.starts_at).toLocaleDateString("fa-IR") : "—"}\nانقضا: ${license.expires_at ? new Date(license.expires_at).toLocaleDateString("fa-IR") : "—"}`, customerKeyboard);
    } else if (["/bots", "🤖 ربات‌های من"].includes(command)) {
      const result = await db.query(
        "SELECT display_name,username,status FROM bots WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",
        [account.rows[0].id],
      );
      const lines = result.rows.map((bot: {display_name:string|null;username:string|null;status:string}) =>
        `• ${bot.display_name || "ربات تلگرام"}${bot.username ? " (@" + bot.username + ")" : ""} — ${bot.status}`);
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
