import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Object storage is not configured");
  return value;
}

function client() {
  return new S3Client({
    region: required("NEON_S3_REGION"),
    endpoint: required("NEON_S3_ENDPOINT"),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("NEON_S3_ACCESS_KEY_ID"),
      secretAccessKey: required("NEON_S3_SECRET_ACCESS_KEY"),
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

export async function putImage(key: string, bytes: Buffer, contentType: string) {
  await client().send(new PutObjectCommand({
    Bucket: required("NEON_S3_BUCKET"),
    Key: key,
    Body: bytes,
    ContentType: contentType,
    ContentLength: bytes.length,
  }));
}

export async function getImage(key: string): Promise<Buffer> {
  const result = await client().send(new GetObjectCommand({
    Bucket: required("NEON_S3_BUCKET"),
    Key: key,
  }));
  if (!result.Body) throw new Error("Stored image body is empty");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteImage(key: string) {
  await client().send(new DeleteObjectCommand({
    Bucket: required("NEON_S3_BUCKET"),
    Key: key,
  }));
}
