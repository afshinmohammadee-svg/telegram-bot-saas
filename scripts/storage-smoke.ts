import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

async function main() {
  const bucket = required("NEON_S3_BUCKET");
  const endpoint = required("NEON_S3_ENDPOINT");
  if (bucket !== "menu-assets" || !endpoint.includes("br-icy-shape-bh6tzhqa.storage.")) {
    throw new Error("Refusing to run: endpoint/bucket are not the approved Neon Preview storage target");
  }
  const botScope = randomUUID();
  const key = `bots/${botScope}/smoke-${randomUUID()}.txt`;
  const client = new S3Client({
    region: required("NEON_S3_REGION"),
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("NEON_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("NEON_S3_SECRET_ACCESS_KEY"),
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const body = Buffer.from("neon-object-storage-smoke");
  let objectMayExist = false;
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "text/plain" }));
    objectMayExist = true;
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const actual = Buffer.from(await got.Body!.transformToByteArray());
    if (!actual.equals(body)) throw new Error("Storage read-back did not match uploaded bytes");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    objectMayExist = false;
    let missing = false;
    try {
      await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      const name = (error as { name?: string }).name ?? "";
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      missing = name === "NoSuchKey" || status === 404;
    }
    if (!missing) throw new Error("Deleted object remained readable");
    console.log("Storage smoke test passed: Preview Put/Get/Delete verified.");
  } finally {
    if (objectMayExist) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined);
    }
    client.destroy();
  }
}

main().catch((error) => {
  const name = error && typeof error === "object" && "name" in error ? String((error as {name:unknown}).name) : "Error";
  console.error(`Storage smoke test failed: ${name}`);
  process.exitCode = 1;
});
