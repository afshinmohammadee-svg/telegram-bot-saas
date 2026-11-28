import type { ApiRequest, ApiResponse } from "./server.js";
import { bodyOf, db, json, ownedBot, requireUser } from "./server.js";
import { isLegacyTelegramPhoto } from "./image-assets.js";

const defaults = {
  theme: "luxury_modern",
  button_columns: 1,
  emoji_mode: "subtle",
  welcome_title: "به فضای اختصاصی ما خوش آمدید",
  welcome_text: "برای مشاهده خدمات و اطلاعات، یکی از گزینه‌های زیر را انتخاب کنید.",
  banner_file_id: "",
  visitor_messages_enabled: true,
};

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
    if (license.rows[0]?.features_snapshot?.menuBuilder !== true) return json(res,403,{error:"امکان شخصی‌سازی منو در لایسنس شما فعال نیست."});

    if (req.method === "GET") {
      const result = await db.query(
        "SELECT theme,button_columns,emoji_mode,welcome_title,welcome_text,banner_file_id,visitor_messages_enabled,updated_at FROM bot_menu_appearance WHERE bot_id=$1",
        [bot.id],
      );
      return json(res, 200, { appearance: { ...defaults, ...(result.rows[0] ?? {}) } });
    }

    if (req.method !== "PATCH") return json(res, 405, { error: "Method not allowed" });
    const body = bodyOf(req);
    const theme = String(body.theme ?? defaults.theme);
    const columns = Number(body.button_columns ?? defaults.button_columns);
    const emojiMode = String(body.emoji_mode ?? defaults.emoji_mode);
    const title = String(body.welcome_title ?? defaults.welcome_title).trim().slice(0, 120);
    const welcome = String(body.welcome_text ?? defaults.welcome_text).trim().slice(0, 700);
    const banner = String(body.banner_file_id ?? "").trim().slice(0, 500);
    const visitorMessagesEnabled = body.visitor_messages_enabled === undefined ? true : body.visitor_messages_enabled === true;
    if (!["luxury_modern","minimal","vibrant"].includes(theme)) return json(res,400,{error:"قالب انتخاب‌شده معتبر نیست."});
    if (!Number.isInteger(columns) || columns < 1 || columns > 3) return json(res,400,{error:"تعداد ستون باید بین ۱ تا ۳ باشد."});
    if (!["off","subtle","expressive"].includes(emojiMode)) return json(res,400,{error:"حالت ایموجی معتبر نیست."});
    if (!title || !welcome) return json(res,400,{error:"عنوان و متن خوشامدگویی نمی‌توانند خالی باشند."});
    if (banner.startsWith("bots/")) {
      const ownedImage = await db.query("SELECT 1 FROM bot_images WHERE bot_id=$1 AND object_key=$2 AND status='active' LIMIT 1", [bot.id, banner]);
      if (!ownedImage.rowCount) return json(res, 400, { error: "شناسه تصویر معتبر نیست." });
    } else if (banner && !isLegacyTelegramPhoto(banner)) {
      return json(res, 400, { error: "برای بنر از بارگذاری تصویر استفاده کن." });
    }
    const result = await db.query(
      `INSERT INTO bot_menu_appearance (bot_id,theme,button_columns,emoji_mode,welcome_title,welcome_text,banner_file_id,visitor_messages_enabled,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (bot_id) DO UPDATE SET theme=EXCLUDED.theme,button_columns=EXCLUDED.button_columns,
         emoji_mode=EXCLUDED.emoji_mode,welcome_title=EXCLUDED.welcome_title,welcome_text=EXCLUDED.welcome_text,
         banner_file_id=EXCLUDED.banner_file_id,visitor_messages_enabled=EXCLUDED.visitor_messages_enabled,updated_at=now()
       RETURNING theme,button_columns,emoji_mode,welcome_title,welcome_text,banner_file_id,visitor_messages_enabled,updated_at`,
      [bot.id,theme,columns,emojiMode,title,welcome,banner || null,visitorMessagesEnabled],
    );
    return json(res,200,{appearance:{...defaults,...result.rows[0]}});
  } catch (error) {
    console.error("bot_menu_appearance_error",error);
    return json(res,500,{error:"ذخیره تنظیمات ظاهر منو ناموفق بود."});
  }
}
