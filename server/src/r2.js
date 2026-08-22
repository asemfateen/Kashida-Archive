import "./env.js";
import { S3Client } from "@aws-sdk/client-s3";

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME,
  );
}

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${(process.env.R2_ACCOUNT_ID || "missing").trim()}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || "").trim(),
  },
  forcePathStyle: true,
  maxAttempts: 3,
  requestHandler: {
    requestTimeout: 30_000,
  },
});

export const R2_BUCKET = process.env.R2_BUCKET_NAME;
