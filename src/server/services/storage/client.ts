import "server-only";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env/server";
import { StorageError } from "./errors";

/**
 * Object-storage client (C4, ADR-007) — the single module that speaks the S3
 * wire format for our media bucket. One code path, two backends: MinIO in dev,
 * Cloudflare R2 in prod (both S3 v4-sig compatible). Only the endpoint + public
 * base URL differ, injected via env — the parity trick A7 used for the local
 * neon-http-proxy. Path-style addressing (`{endpoint}/{bucket}/{key}`) works
 * for both.
 *
 * Built lazily on first use (like getRedis / the OpenRouter + Zernio clients),
 * so missing creds never break builds or unit suites — only a real upload.
 * Region defaults to "auto" (R2's value; MinIO is configured to match in
 * docker-compose).
 */
export type StorageClient = {
  aws: AwsClient;
  endpoint: string;
  bucket: string;
  publicBaseUrl: string;
  region: string;
};

let client: StorageClient | null = null;

/** Resolve the R2/MinIO endpoint: explicit `R2_ENDPOINT` wins, else derive the
 * R2 host from `R2_ACCOUNT_ID`. Returns undefined when neither is set. */
function resolveEndpoint(): string | undefined {
  if (env.R2_ENDPOINT) return env.R2_ENDPOINT.replace(/\/+$/, "");
  if (env.R2_ACCOUNT_ID) {
    return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  return undefined;
}

export function getStorageClient(): StorageClient {
  if (client) return client;

  const endpoint = resolveEndpoint();
  const {
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
    R2_PUBLIC_BASE_URL,
  } = env;

  if (
    !endpoint ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET ||
    !R2_PUBLIC_BASE_URL
  ) {
    throw new StorageError(
      "Object storage is not configured (need R2_ENDPOINT|R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL).",
    );
  }

  client = {
    aws: new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: env.R2_REGION ?? "auto",
    }),
    endpoint,
    bucket: R2_BUCKET,
    publicBaseUrl: R2_PUBLIC_BASE_URL.replace(/\/+$/, ""),
    region: env.R2_REGION ?? "auto",
  };
  return client;
}
