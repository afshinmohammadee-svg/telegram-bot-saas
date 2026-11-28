import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Pool } from "pg";

const previewUrl = process.env.PREVIEW_DATABASE_URL;
const productionUrl = process.env.PRODUCTION_DATABASE_URL;
const encryptionKeyRaw = process.env.BOT_TOKEN_ENCRYPTION_KEY;
const productionAppUrl = (process.env.PRODUCTION_APP_URL || "https://telegram-bot-saas-app-ggr7-production.up.railway.app").replace(/\/$/, "");
const allowedHosts = new Set([
  "telegram-bot-saas-app-preview.up.railway.app",
  "telegram-bot-saas-app-ggr7-production.up.railway.app",
  "telegram-bot-saas-git-feat-license-customer-menu-a5fd88-afshin7.vercel.app",
]);

if (!previewUrl || !productionUrl || !encryptionKeyRaw) {
  throw new Error("Set PREVIEW_DATABASE_URL, PRODUCTION_DATABASE_URL and BOT_TOKEN_ENCRYPTION_KEY in your local environment.");
}
if (!productionAppUrl.startsWith("https://")) throw new Error("PRODUCTION_APP_URL must use HTTPS.");

function encryptionKey(): Buffer {
  if (/^[a-f0-9]{64}$/i.test(encryptionKeyRaw!)) return Buffer.from(encryptionKeyRaw!, "hex");
  const decoded = Buffer.from(encryptionKeyRaw!, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(encryptionKeyRaw!, "utf8").digest();
}
function decryptToken(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported encrypted token format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
async function telegram<T>(token: string, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
  return result.result as T;
}

type BotRow = { id: string; username: string | null; status: string; encrypted_token: string };
const preview = new Pool({ connectionString: previewUrl, max: 2, connectionTimeoutMillis: 10000 });
const production = new Pool({ connectionString: productionUrl, max: 2, connectionTimeoutMillis: 10000 });

try {
  const source = await preview.query<BotRow>(
    `SELECT b.id, b.username, b.status, s.encrypted_token
       FROM bots b JOIN bot_secrets s ON s.bot_id=b.id
      WHERE b.status='active' ORDER BY b.created_at`
  );
  if (!source.rowCount) throw new Error("No active bots with encrypted tokens were found in Preview.");

  // Validate every encrypted token locally before changing Production. No token or ciphertext is logged.
  const validated: Array<{ bot: BotRow; token: string }> = [];
  for (const bot of source.rows) {
    const token = decryptToken(bot.encrypted_token);
    const me = await telegram<{ username?: string }>(token, "getMe");
    if (bot.username && me.username?.toLowerCase() !== bot.username.toLowerCase()) {
      throw new Error(`Telegram identity mismatch for bot record ${bot.id}; no Production changes were made.`);
    }
    const current = await telegram<{ url?: string }>(token, "getWebhookInfo");
    if (current.url) {
      let host = "";
      try { host = new URL(current.url).hostname; } catch {}
      if (!allowedHosts.has(host)) throw new Error(`Bot ${bot.username || bot.id} currently points to an unrecognized webhook host; refusing to overwrite it.`);
    }
    validated.push({ bot, token });
  }

  const accountRows = await preview.query(
    `SELECT id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
            access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at
       FROM account ORDER BY created_at`
  );

  await production.query("BEGIN");
  try {
    for (const { bot } of validated) {
      await production.query(
        `INSERT INTO bot_secrets (bot_id, encrypted_token, encryption_key_version, created_at, rotated_at)
         VALUES ($1,$2,1,now(),NULL) ON CONFLICT (bot_id) DO NOTHING`,
        [bot.id, bot.encrypted_token]
      );
    }
    for (const row of accountRows.rows) {
      await production.query(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
           access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.account_id, row.provider_id, row.user_id, row.access_token, row.refresh_token,
         row.id_token, row.access_token_expires_at, row.refresh_token_expires_at, row.scope,
         row.password, row.created_at, row.updated_at]
      );
    }
    await production.query("COMMIT");
  } catch (error) {
    await production.query("ROLLBACK");
    throw error;
  }

  for (const { bot, token } of validated) {
    const secret = randomBytes(32).toString("hex");
    const previous = await production.query<{ webhook_secret_hash: string | null }>(
      "SELECT webhook_secret_hash FROM bots WHERE id=$1", [bot.id]
    );
    if (!previous.rowCount) throw new Error(`Production bot row missing for ${bot.username || bot.id}.`);
    await production.query("UPDATE bots SET webhook_secret_hash=$1 WHERE id=$2", [sha256(secret), bot.id]);
    try {
      const webhook = new URL("/api/telegram/webhook", productionAppUrl);
      webhook.searchParams.set("botId", bot.id);
      await telegram(token, "setWebhook", {
        url: webhook.toString(),
        secret_token: secret,
        allowed_updates: ["message", "edited_message", "callback_query"],
        drop_pending_updates: false,
      });
      console.log(`Customer bot connected to Production: @${bot.username || bot.id}`);
    } catch (error) {
      await production.query("UPDATE bots SET webhook_secret_hash=$1 WHERE id=$2", [previous.rows[0].webhook_secret_hash, bot.id]);
      throw error;
    }
  }

  const managementToken = process.env.MANAGEMENT_BOT_TOKEN;
  const managementSecret = process.env.MANAGEMENT_BOT_WEBHOOK_SECRET;
  if (Boolean(managementToken) !== Boolean(managementSecret)) {
    throw new Error("Set both MANAGEMENT_BOT_TOKEN and MANAGEMENT_BOT_WEBHOOK_SECRET to migrate the management bot webhook, or leave both unset.");
  }
  if (managementToken && managementSecret) {
    const me = await telegram<{ username?: string }>(managementToken, "getMe");
    const current = await telegram<{ url?: string }>(managementToken, "getWebhookInfo");
    if (current.url) {
      let host = "";
      try { host = new URL(current.url).hostname; } catch {}
      if (!allowedHosts.has(host)) throw new Error("Management bot currently points to an unrecognized webhook host; refusing to overwrite it.");
    }
    const url = new URL("/api/telegram/management-webhook", productionAppUrl).toString();
    await telegram(managementToken, "setWebhook", {
      url, secret_token: managementSecret, allowed_updates: ["message"], drop_pending_updates: false,
    });
    console.log(`Management bot webhook connected to Production: @${me.username || "management-bot"}`);
  } else {
    console.log("Management bot webhook was not changed (management credentials were not provided locally).");
  }

  const verification = await production.query(
    `SELECT b.username, (s.bot_id IS NOT NULL) AS has_encrypted_token
       FROM bots b LEFT JOIN bot_secrets s ON s.bot_id=b.id
      ORDER BY b.created_at`
  );
  for (const row of verification.rows) {
    if (!row.has_encrypted_token) throw new Error(`Production token verification failed for ${row.username || "a bot"}.`);
  }
  console.log(`Production migration complete: ${validated.length} customer bot token(s), ${accountRows.rowCount} auth account row(s) copied.`);
} finally {
  await Promise.all([preview.end(), production.end()]);
}
