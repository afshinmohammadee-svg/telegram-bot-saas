import type { ApiRequest, ApiResponse } from "../_lib/server.js";
import { db, decryptToken, json, safeEqualHex, sha256, subscriptionActive, telegram } from "../_lib/server.js";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; language_code?: string };
type TgMessage = { message_id: number; date: number; chat: { id: number; type: string }; from?: TgUser; text?: string };
type TgCallback = { id: string; data?: string; from: TgUser; message?: TgMessage };
type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallback };

function escapeHtml(value: string) {
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

type MenuRow = {id:string;title:string;description:string|null;parent_id:string|null;response_type:string;response_content:string|null;target_url:string|null;has_children?:boolean};
type MenuAppearance = {theme:string;button_columns:number;emoji_mode:string;welcome_title:string;welcome_text:string;banner_file_id:string|null};
function menuLabel(item:MenuRow,index:number,appearance:MenuAppearance){if(appearance.emoji_mode==="off")return item.title;let icon=appearance.theme==="minimal"?"·":appearance.theme==="vibrant"?(item.response_type==="url"?"🔗":item.response_type==="submenu"?"📂":"✨"):(item.response_type==="url"?"↗️":item.response_type==="submenu"?"✧":"◆");if(appearance.emoji_mode==="expressive"){const icons=["💎","✨","🌙","🪄","🖋️","🎯","🛍️","📌"];icon=icons[index%icons.length];}return(icon?icon+" ":"")+item.title;}
async function getMenuAppearance(botId:string):Promise<MenuAppearance>{const result=await db.query("SELECT theme,button_columns,emoji_mode,welcome_title,welcome_text,banner_file_id FROM bot_menu_appearance WHERE bot_id=$1",[botId]);return result.rows[0]??{theme:"luxury_modern",button_columns:1,emoji_mode:"subtle",welcome_title:"به فضای اختصاصی ما خوش آمدید",welcome_text:"برای مشاهده خدمات و اطلاعات، یکی از گزینه‌های زیر را انتخاب کنید.",banner_file_id:null};}
async function menuKeyboard(botId:string,parentId:string|null,appearance:MenuAppearance){const result=await db.query(`SELECT m.id,m.title,m.description,m.parent_id,m.response_type,m.response_content,m.target_url,EXISTS(SELECT 1 FROM bot_menus child WHERE child.parent_id=m.id AND child.bot_id=m.bot_id AND child.is_active=true) AS has_children FROM bot_menus m WHERE m.bot_id=$1 AND m.parent_id IS NOT DISTINCT FROM $2::uuid AND m.is_active=true ORDER BY m.sort_order,m.title LIMIT 100`,[botId,parentId]);const rows=result.rows as MenuRow[];const columns=Math.max(1,Math.min(3,Number(appearance.button_columns)||1));const keyboard:Array<Array<{text:string}>>=[];for(let i=0;i<rows.length;i+=columns)keyboard.push(rows.slice(i,i+columns).map((item,index)=>({text:menuLabel(item,i+index,appearance).slice(0,64)})));if(parentId)keyboard.push([{text:"⬅️ بازگشت"},{text:"🏠 منوی اصلی"}]);return{rows,keyboard:{keyboard,resize_keyboard:true,is_persistent:true,input_field_placeholder:"یکی از گزینه‌ها را انتخاب کنید"}};}
async function sendMenuPhoto(token:string,chatId:number,photo:string,caption?:string,replyMarkup?:Record<string,unknown>){
  if(!photo.startsWith("tgphoto:")) return telegram(token,"sendPhoto",{chat_id:chatId,photo,...(caption?{caption}:{}),...(replyMarkup?{reply_markup:replyMarkup}:{})});
  const [,mime,base64]=photo.split(":",3);
  if(!mime||!base64) throw new Error("Stored photo payload is invalid");
  const form=new FormData();form.set("chat_id",String(chatId));form.set("photo",new Blob([Buffer.from(base64,"base64")],{type:mime}),"menu-image");
  if(caption) form.set("caption",caption);
  if(replyMarkup) form.set("reply_markup",JSON.stringify(replyMarkup));
  const response=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:"POST",body:form});
  const result=await response.json() as {ok:boolean;description?:string};
  if(!response.ok||!result.ok) throw new Error(result.description||"Telegram photo upload failed");
}
async function showMenu(token:string,botId:string,chatId:number,parentId:string|null,visitorId?:string){const appearance=await getMenuAppearance(botId);const{rows,keyboard}=await menuKeyboard(botId,parentId,appearance);if(visitorId)await db.query(`INSERT INTO bot_visitor_menu_state(visitor_id,bot_id,current_parent_id,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(visitor_id) DO UPDATE SET bot_id=EXCLUDED.bot_id,current_parent_id=EXCLUDED.current_parent_id,updated_at=now()`,[visitorId,botId,parentId]);if(!rows.length){await telegram(token,"sendMessage",{chat_id:chatId,text:"برای این بخش هنوز گزینه‌ای تعریف نشده است.",reply_markup:keyboard});return;}const mark=appearance.theme==="minimal"?"":appearance.theme==="vibrant"?"🌈 ":"✦ ";let heading=mark+String(appearance.welcome_title||"به فضای اختصاصی ما خوش آمدید");if(parentId){const path=await db.query(`WITH RECURSIVE menu_path AS (SELECT id,title,parent_id,0 AS depth FROM bot_menus WHERE id=$1 AND bot_id=$2 UNION ALL SELECT p.id,p.title,p.parent_id,c.depth+1 FROM bot_menus p JOIN menu_path c ON c.parent_id=p.id WHERE p.bot_id=$2) SELECT title FROM menu_path ORDER BY depth DESC`,[parentId,botId]);heading=mark+(path.rows.map((x:{title:string})=>x.title).join("  ›  ")||heading);}const caption=parentId?"<b>"+escapeHtml(heading)+"</b>\n\n"+escapeHtml("یکی از گزینه‌های مرتبط را انتخاب کنید:"):"<b>"+escapeHtml(heading)+"</b>\n\n"+escapeHtml(String(appearance.welcome_text||"برای ادامه یکی از گزینه‌ها را انتخاب کنید."));if(!parentId&&appearance.banner_file_id)await sendMenuPhoto(token,chatId,appearance.banner_file_id,caption,keyboard);else await telegram(token,"sendMessage",{chat_id:chatId,text:caption,parse_mode:"HTML",reply_markup:keyboard});}
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const rawId = req.query.botId;
  const botId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!botId) return json(res, 400, { error: "Missing bot id" });
  let retryableBotId: string | null = null;
  let retryableUpdateId: number | null = null;
  try {
    const botResult = await db.query(
      "SELECT b.id,b.owner_id,b.status,b.webhook_secret_hash,s.encrypted_token FROM bots b JOIN bot_secrets s ON s.bot_id=b.id WHERE b.id=$1 LIMIT 1",
      [botId],
    );
    const bot = botResult.rows[0];
    if (!bot || bot.status !== "active") return json(res, 200, { ok: true });
    const supplied = req.headers["x-telegram-bot-api-secret-token"];
    const secret = Array.isArray(supplied) ? supplied[0] : supplied;
    if (!secret || !safeEqualHex(sha256(secret), bot.webhook_secret_hash)) return json(res, 403, { error: "Forbidden" });

    const update = (req.body && typeof req.body === "object" ? req.body : {}) as TgUpdate;
    if (!Number.isSafeInteger(update.update_id)) return json(res, 400, { error: "Invalid update" });
    const inserted = await db.query(
      "INSERT INTO telegram_updates (bot_id,update_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING update_id",
      [bot.id, update.update_id],
    );
    if (!inserted.rowCount) return json(res, 200, { ok: true, duplicate: true });
    // If processing fails, remove the dedupe marker so Telegram's webhook retry can process this update again.
    retryableBotId = bot.id;
    retryableUpdateId = update.update_id;

    const callback = update.callback_query;
    if (callback) {
      const callbackChatId = callback.message?.chat.id;
      const callbackData = callback.data ?? "";
      const subscription = await subscriptionActive(bot.owner_id);
      if (callbackChatId && subscription) {
        const token = decryptToken(bot.encrypted_token);
        if (callbackData.startsWith("menu:")) {
          const menuId = callbackData.slice(5);
          const selected = await db.query(
            `SELECT m.id,m.title,m.description,m.parent_id,m.response_type,m.response_content,m.target_url,
                    EXISTS (SELECT 1 FROM bot_menus child WHERE child.parent_id=m.id AND child.bot_id=m.bot_id AND child.is_active=true) AS has_children
               FROM bot_menus m WHERE m.id=$1 AND m.bot_id=$2 AND m.is_active=true`,
            [menuId,bot.id],
          );
          const item = selected.rows[0];
          if (item) {
            // Treat any item with active children as a submenu, even if it was saved with a content response type.
            if (item.response_type === "submenu" || item.has_children === true) {
              await showMenu(token,bot.id,callbackChatId,item.id);
            } else {
              const content = String(item.response_content ?? item.description ?? item.title);
              // Back returns to the menu that directly contained this item.
              // Main remains a separate action that always returns to the root menu.
              const keyboard = {
                keyboard: [[{text:"⬅️ بازگشت"}],[{text:"🏠 منوی اصلی"}]],
                resize_keyboard: true,
                is_persistent: true,
              };
              const replyMarkup = {reply_markup:keyboard};
              if (item.response_type === "photo") {
                await sendMenuPhoto(token,callbackChatId,content,item.description?String(item.description).slice(0,1000):undefined,keyboard);
              } else if (item.response_type === "document") {
                await telegram(token,"sendDocument",{chat_id:callbackChatId,document:content,...replyMarkup});
              } else {
                await telegram(token,"sendMessage",{chat_id:callbackChatId,text:content,...replyMarkup});
              }
            }
          }
        } else if (callbackData.startsWith("back:")) {
          const parent = callbackData.slice(5);
          await showMenu(token,bot.id,callbackChatId,parent==="root"?null:parent);
        } else if (callbackData === "main:root") {
          await showMenu(token,bot.id,callbackChatId,null);
        }
      }
      await telegram(decryptToken(bot.encrypted_token),"answerCallbackQuery",{callback_query_id:callback.id});
      return json(res,200,{ok:true});
    }

    const message = update.message;
    const sender = message?.from;
    if (!message || !sender || message.chat.type !== "private" || sender.is_bot) return json(res, 200, { ok: true });

    const text = (message.text ?? "").slice(0, 4096);
    // Block expired/suspended customers before persisting visitor or conversation activity.
    const subscription = await subscriptionActive(bot.owner_id);
    if (!subscription) return json(res, 200, { ok: true, subscriptionInactive: true });
    const accessResult = await db.query(
      `SELECT limits_snapshot FROM licenses
        WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now()
        ORDER BY expires_at DESC LIMIT 1`,
      [bot.owner_id],
    );
    const visitorLimit = accessResult.rows[0]?.limits_snapshot?.maxVisitors;
    if (Number.isInteger(visitorLimit) && visitorLimit >= 0) {
      const knownVisitor = await db.query(
        "SELECT 1 FROM bot_visitors WHERE bot_id=$1 AND telegram_user_id=$2 LIMIT 1",
        [bot.id,sender.id],
      );
      if (!knownVisitor.rowCount) {
        const visitorCount = await db.query("SELECT count(*)::int AS total FROM bot_visitors WHERE bot_id=$1", [bot.id]);
        if (visitorCount.rows[0].total >= visitorLimit) return json(res,200,{ok:true,visitorLimitReached:true});
      }
    }
    const client = await db.connect();
    let visitorId: string;
    let conversationId: string;
    try {
      await client.query("BEGIN");
      const visitor = await client.query(
        `INSERT INTO bot_visitors (bot_id,telegram_user_id,chat_id,username,first_name,last_name,language_code,is_bot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false)
         ON CONFLICT (bot_id,telegram_user_id) DO UPDATE SET
           chat_id=EXCLUDED.chat_id, username=EXCLUDED.username, first_name=EXCLUDED.first_name,
           last_name=EXCLUDED.last_name, language_code=EXCLUDED.language_code,last_seen_at=now()
         RETURNING id`,
        [bot.id, sender.id, message.chat.id, sender.username ?? null, sender.first_name ?? null, sender.last_name ?? null, sender.language_code ?? null],
      );
      visitorId = visitor.rows[0].id;
      const conversation = await client.query(
        `INSERT INTO conversations (bot_id,visitor_id,last_message_at)
         VALUES ($1,$2,now()) ON CONFLICT (bot_id,visitor_id) DO UPDATE SET
         status='open',last_message_at=now(),updated_at=now() RETURNING id`,
        [bot.id, visitorId],
      );
      conversationId = conversation.rows[0].id;
      await client.query(
        `INSERT INTO messages (conversation_id,telegram_message_id,direction,sender_type,text_body,telegram_payload,delivery_status,sent_at)
         VALUES ($1,$2,'inbound','visitor',$3,$4::jsonb,'received',now())`,
        [conversationId, message.message_id, text || null, JSON.stringify(message)],
      );
      await client.query("UPDATE conversations SET unread_count=unread_count+1 WHERE id=$1", [conversationId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (text.startsWith("/start")) {
      const token = decryptToken(bot.encrypted_token);
      const startPayload = text.match(/^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?/i)?.[1];
      let targetMenuId: string | null = null;
      if (startPayload) {
        const startLink = await db.query(
          `SELECT menu_id FROM bot_start_links
            WHERE bot_id=$1 AND token_hash=$2 AND is_active=true LIMIT 1`,
          [bot.id, sha256(startPayload)],
        );
        if (startLink.rowCount) targetMenuId = startLink.rows[0].menu_id ?? null;
      }
      await showMenu(token,bot.id,message.chat.id,targetMenuId,visitorId);
      return json(res, 200, { ok: true, stored: true });
    }
    if (text && !text.startsWith("/")) {
      const state=await db.query("SELECT current_parent_id FROM bot_visitor_menu_state WHERE visitor_id=$1 AND bot_id=$2 LIMIT 1",[visitorId,bot.id]);
      const currentParent=state.rows[0]?.current_parent_id??null;
      const appearance=await getMenuAppearance(bot.id);
      if(text==="🏠 منوی اصلی"){await showMenu(decryptToken(bot.encrypted_token),bot.id,message.chat.id,null,visitorId);return json(res,200,{ok:true,stored:true,menuNavigation:true});}
      if(text==="⬅️ بازگشت"){let target:string|null=null;if(currentParent){const parent=await db.query("SELECT parent_id FROM bot_menus WHERE id=$1 AND bot_id=$2",[currentParent,bot.id]);target=parent.rows[0]?.parent_id??null;}await showMenu(decryptToken(bot.encrypted_token),bot.id,message.chat.id,target,visitorId);return json(res,200,{ok:true,stored:true,menuNavigation:true});}
      const {rows}=await menuKeyboard(bot.id,currentParent,appearance);
      const selected=rows.find((item,index)=>menuLabel(item,index,appearance)===text);
      if(selected){if(selected.response_type==="submenu"||selected.has_children===true)await showMenu(decryptToken(bot.encrypted_token),bot.id,message.chat.id,selected.id,visitorId);else{const content=String(selected.response_type==="url"?selected.target_url??"":selected.response_content??selected.description??selected.title);const nav=await menuKeyboard(bot.id,currentParent,appearance);if(selected.response_type==="photo")await sendMenuPhoto(decryptToken(bot.encrypted_token),message.chat.id,content,selected.description?String(selected.description).slice(0,1000):undefined,nav.keyboard);else if(selected.response_type==="document")await telegram(decryptToken(bot.encrypted_token),"sendDocument",{chat_id:message.chat.id,document:content,reply_markup:nav.keyboard});else await telegram(decryptToken(bot.encrypted_token),"sendMessage",{chat_id:message.chat.id,text:selected.response_type==="url"?"🔗 لینک موردنظر:\n"+content:content,reply_markup:nav.keyboard,disable_web_page_preview:true});}return json(res,200,{ok:true,stored:true,menuSelection:true});}
    }
    if (text) {
      const rules = await db.query(
        "SELECT trigger_text,reply_text,match_type FROM auto_replies WHERE bot_id=$1 AND is_enabled=true ORDER BY created_at ASC",
        [bot.id],
      );
      const normalized = text.toLocaleLowerCase("fa");
      const match = rules.rows.find((rule: { trigger_text: string; match_type: string }) => {
        const trigger = rule.trigger_text.toLocaleLowerCase("fa");
        if (rule.match_type === "exact") return normalized === trigger;
        if (rule.match_type === "starts_with") return normalized.startsWith(trigger);
        return normalized.includes(trigger);
      });
      if (match) {
        const sent = await telegram<{ message_id: number }>(decryptToken(bot.encrypted_token), "sendMessage", { chat_id: message.chat.id, text: match.reply_text });
        await db.query(
          "INSERT INTO messages (conversation_id,telegram_message_id,direction,sender_type,text_body,delivery_status,sent_at) VALUES ($1,$2,'outbound','system',$3,'sent',now())",
          [conversationId, sent.message_id, match.reply_text],
        );
      }
    }
    return json(res, 200, { ok: true, stored: true });
  } catch (error) {
    if (retryableBotId && retryableUpdateId !== null) {
      try {
        await db.query("DELETE FROM telegram_updates WHERE bot_id=$1 AND update_id=$2", [retryableBotId, retryableUpdateId]);
      } catch (cleanupError) {
        console.error("telegram_update_retry_cleanup_error", cleanupError);
      }
    }
    console.error("telegram_webhook_error", error);
    return json(res, 500, { error: "Webhook processing failed" });
  }
}
