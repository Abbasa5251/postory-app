import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env/server";

/**
 * Signed OAuth state for the Zernio connect flow (ADR-014 + §7). Set as an
 * HttpOnly cookie at connect-init and verified on the callback: it proves WE
 * initiated the flow (CSRF — a forged hit on the callback route carries no
 * valid state) and correlates the callback back to the originating brand +
 * profile without trusting Zernio to echo anything. HMAC-SHA256 keyed on
 * BETTER_AUTH_SECRET; the flow never depends on Zernio round-tripping state.
 */

export const OAUTH_STATE_COOKIE = "postory.zernio_oauth_state";
const TTL_MS = 10 * 60 * 1000; // 10 min — an OAuth consent shouldn't outlive this.

export type OAuthState = {
  brandId: string;
  profileId: string;
  platform: string;
};

type Payload = OAuthState & { nonce: string; exp: number };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string): string {
  return b64url(
    createHmac("sha256", env.BETTER_AUTH_SECRET).update(data).digest(),
  );
}

/** Serialize + sign a state value for the cookie (nonce + expiry baked in). */
export function createState(state: OAuthState): string {
  const payload: Payload = {
    ...state,
    nonce: b64url(randomBytes(12)),
    exp: Date.now() + TTL_MS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

/**
 * Verify a cookie value: constant-time signature check + expiry. Returns the
 * state, or null if tampered/expired/malformed (callers treat null as "reject
 * this callback").
 */
export function verifyState(token: string | undefined): OAuthState | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Payload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now())
      return null;
    if (!payload.brandId || !payload.profileId || !payload.platform)
      return null;
    return {
      brandId: payload.brandId,
      profileId: payload.profileId,
      platform: payload.platform,
    };
  } catch {
    return null;
  }
}
