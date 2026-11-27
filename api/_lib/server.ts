import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool } from "pg";
import { auth } from "../../src/lib/auth.js";

const globalForPool = globalThis as typeof globalThis & { __telegramPool?: Pool };
export const db = globalForPool.__telegramPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});
if (process.env.NODE_ENV !== "production") globalForPool.__telegramPool = db;

export type ApiRequest = IncomingMessage & { query: Record<string, string | string[] | undefined>; body?: unknown };
export type ApiResponse = ServerResponse & { status?: (code: number) => ApiResponse; json?: (value: unknown) => void };

export function json(res: ApiResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export async function currentUser(req: ApiRequest) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value !== undefined) headers.set(key, value);
  }
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}

export async function requireUser(req: ApiRequest, res: ApiResponse) {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { error: "برای ادامه وارد حساب شوید." });
    return null;
  }
  return user;
}

export function encryptionKey(): Buffer {
  const raw = process.env.BOT_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("BOT_TOKEN_ENCRYPTION_KEY is not configured");
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(payload: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export async function telegram<T>(token: string, method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API error: ${response.status}`);
  return result.result as T;
}

export async function ownedBot(userId: string, botId?: string) {
  const result = await db.query(
    `SELECT b.*, s.encrypted_token
       FROM bots b LEFT JOIN bot_secrets s ON s.bot_id=b.id
      WHERE b.owner_id=$1 ${botId ? "AND b.id=$2" : ""} ORDER BY b.created_at DESC LIMIT 1`,
    botId ? [userId, botId] : [userId],
  );
  return result.rows[0] ?? null;
}

// License instances are the source of truth. Legacy subscriptions are consulted
// only for accounts that have never received a license record.
export async function subscriptionActive(userId: string) {
  const license = await db.query(
    `SELECT expires_at FROM licenses
      WHERE user_id=$1 AND status='active' AND starts_at<=now() AND expires_at>now()
      ORDER BY expires_at DESC LIMIT 1`,
    [userId],
  );
  if (license.rowCount) return license.rows[0];

  const hasLicenseHistory = await db.query(
    "SELECT 1 FROM licenses WHERE user_id=$1 LIMIT 1",
    [userId],
  );
  if (hasLicenseHistory.rowCount) return null;

  const legacy = await db.query(
    "SELECT expires_at FROM subscriptions WHERE user_id=$1 AND starts_at<=now() AND expires_at>now() LIMIT 1",
    [userId],
  );
  return legacy.rows[0] ?? null;
}
