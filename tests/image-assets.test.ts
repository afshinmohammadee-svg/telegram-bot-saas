import test from "node:test";
import assert from "node:assert/strict";
import { detectImage, isLegacyTelegramPhoto, MAX_IMAGE_BYTES, newImageKey, validateImage } from "../api/_lib/image-assets.js";

const jpeg = (size=16) => { const b=Buffer.alloc(size); b.set([0xff,0xd8,0xff]); return b; };
const png = () => { const b=Buffer.alloc(16); b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]); return b; };
const webp = () => { const b=Buffer.alloc(16); b.write("RIFF",0); b.write("WEBP",8); return b; };

test("detects JPEG, PNG and WebP from signatures",()=>{
 assert.equal(detectImage(jpeg()).mimeType,"image/jpeg");
 assert.equal(detectImage(png()).mimeType,"image/png");
 assert.equal(detectImage(webp()).mimeType,"image/webp");
});
test("accepts exactly 300 KiB and rejects larger files",()=>{
 assert.equal(validateImage(jpeg(MAX_IMAGE_BYTES)).mimeType,"image/jpeg");
 assert.throws(()=>validateImage(jpeg(MAX_IMAGE_BYTES+1)),/۳۰۰/);
});
test("rejects empty and unsupported files",()=>{
 assert.throws(()=>validateImage(Buffer.alloc(0)));
 assert.throws(()=>detectImage(Buffer.from("not an image")));
});
test("generates bot-scoped random keys",()=>{
 const a=newImageKey("bot-1","jpg"), b=newImageKey("bot-1","jpg");
 assert.match(a,/^bots\/bot-1\/images\/.+\.jpg$/);
 assert.notEqual(a,b);
});
test("recognizes legacy Telegram image payloads for quota accounting",()=>{
 assert.equal(isLegacyTelegramPhoto("tgphoto:image/jpeg:YWJj"),true);
 assert.equal(isLegacyTelegramPhoto("tgphoto:image/gif:YWJj"),false);
});
