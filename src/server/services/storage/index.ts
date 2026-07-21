import "server-only";
import { getStorageClient } from "./client";
import { StorageError } from "./errors";

/**
 * Object-storage service barrel (C4, ADR-007). The only place the R2/MinIO key
 * layout and presigning live (§4 single source). Uploads flow presigned
 * direct-to-store PUT: the action mints a server-generated key + a presigned
 * URL, the client uploads bytes straight to the store, and the record action
 * confirms via a server→store HEAD (mime + size are enforced there, never from
 * client claims — §7 SSRF-safe: we only ever HEAD keys we minted).
 */

export { StorageError } from "./errors";

/** Presigned-URL lifetime — long enough for a large video PUT, short enough to
 * not linger. */
const PRESIGN_EXPIRY_SECONDS = 600;

/** HEAD deadline — a hung store must never hang the record action (§ like the
 * Zernio client's 15s timeout). */
const HEAD_TIMEOUT_MS = 15_000;

/** Percent-encode each path segment while preserving the `/` separators. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * ADR-007 key layout: `org/{orgId}/brand/{brandId}/{uuid}.{ext}`. The random
 * name guarantees uniqueness (the `media_assets.r2_key` unique index is the
 * backstop); the key is ALWAYS built server-side from ctx ids, never from
 * client input.
 */
export function buildMediaKey(
  orgId: string,
  brandId: string,
  ext: string,
): string {
  const name = globalThis.crypto.randomUUID();
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `org/${orgId}/brand/${brandId}/${name}${safeExt ? `.${safeExt}` : ""}`;
}

/**
 * Mint a presigned PUT URL for a key. Content-type/size are NOT bound in the
 * signature (keeps MinIO + R2 behaviour identical and avoids signed-header
 * fragility) — they are enforced authoritatively by `headObject` after upload.
 */
export async function presignPut(key: string): Promise<string> {
  const { aws, endpoint, bucket, region } = getStorageClient();
  const url = new URL(`${endpoint}/${bucket}/${encodeKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(PRESIGN_EXPIRY_SECONDS));
  const signed = await aws.sign(url.toString(), {
    method: "PUT",
    aws: { signQuery: true, service: "s3", region },
  });
  return signed.url;
}

/**
 * HEAD an object to confirm it exists and read its ACTUAL content-type + size
 * (the server-authoritative mime/size gate — D-C4-3). Returns null when the
 * object is absent (client never completed the PUT).
 */
export async function headObject(
  key: string,
): Promise<{ contentType: string | null; sizeBytes: number } | null> {
  const { aws, endpoint, bucket, region } = getStorageClient();
  const url = `${endpoint}/${bucket}/${encodeKey(key)}`;

  // Bound the request: a hung store must fail loudly, not hang recordUpload.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  let res: Response;
  try {
    res = await aws.fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      aws: { service: "s3", region },
    });
  } catch (error) {
    throw new StorageError(
      controller.signal.aborted
        ? `HEAD ${key} timed out after ${HEAD_TIMEOUT_MS}ms`
        : `HEAD ${key} request failed`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new StorageError(`HEAD ${key} failed with status ${res.status}`);
  }

  // Content-length is authoritative for the size gate — a missing or malformed
  // value would let NaN slip past `sizeBytes > maxBytes`, so reject it outright.
  const len = res.headers.get("content-length");
  const sizeBytes = len === null ? NaN : Number(len);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new StorageError(
      `HEAD ${key} returned an invalid content-length: ${len ?? "(none)"}`,
    );
  }
  return { contentType: res.headers.get("content-type"), sizeBytes };
}

/** Public (CDN in prod, MinIO in dev) URL for serving a stored object. */
export function publicUrl(key: string): string {
  return `${getStorageClient().publicBaseUrl}/${encodeKey(key)}`;
}
