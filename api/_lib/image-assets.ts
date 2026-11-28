import { randomUUID, createHash } from "node:crypto";

export const MAX_IMAGE_BYTES = 300 * 1024;
export const MAX_IMAGES_PER_BOT = 5;

export function exceedsImageQuota(storedCount: number, legacyCount: number, replacingExisting: boolean): boolean {
  return !replacingExisting && storedCount + legacyCount >= MAX_IMAGES_PER_BOT;
}

export type SupportedImage = { mimeType: "image/jpeg" | "image/png" | "image/webp"; extension: "jpg" | "png" | "webp" };

export function detectImage(bytes: Buffer): SupportedImage {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mimeType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))
    return { mimeType: "image/png", extension: "png" };
  if (bytes.length >= 12 && bytes.toString("ascii",0,4)==="RIFF" && bytes.toString("ascii",8,12)==="WEBP")
    return { mimeType: "image/webp", extension: "webp" };
  throw new Error("فرمت تصویر باید JPEG، PNG یا WebP باشد.");
}

export function validateImage(bytes: Buffer): SupportedImage {
  if (!bytes.length) throw new Error("فایل تصویر خالی است.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("حجم تصویر نباید بیشتر از ۳۰۰ کیلوبایت باشد.");
  return detectImage(bytes);
}

export function newImageKey(botId: string, extension: string) {
  return `bots/${botId}/images/${randomUUID()}.${extension}`;
}

export function imageSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isLegacyTelegramPhoto(value: unknown): boolean {
  return typeof value === "string" && /^tgphoto:image\/(?:jpeg|png|webp):[A-Za-z0-9+/=]+$/.test(value);
}
