import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env/server";
import { ZernioError } from "./errors";
import {
  accountsHealthResponseSchema,
  accountsResponseSchema,
  connectResponseSchema,
  normalizeAccount,
  profileCreateResponseSchema,
  type AccountHealthEntry,
  type NormalizedAccount,
} from "./schemas";

/**
 * Zernio API client — the single module that speaks Zernio's wire format
 * (the publishing sibling of the OpenRouter service, ADR-012 ethos). Owns the
 * base URL, auth header, timeout, error mapping, and zod response parsing.
 * Only the interactive OAuth touchpoints (connect-init, callback) call it from
 * a request handler; that inline use is the ADR-014 carve-out from ADR-003.
 *
 * ⚠️ VERIFY (§3): request paths below match the documented quickstart
 * (`/profiles`, `/connect/{platform}`, `/accounts`); the health path and the
 * disconnect verb/path are best-effort and flagged inline — confirm against the
 * live API / OpenAPI before B3 ships.
 */

const BASE_URL = "https://zernio.com/api/v1";
const TIMEOUT_MS = 15_000;

function apiKey(): string {
  // Lazy (like getRedis): unset is fine for local/CI builds and the mocked unit
  // suites; a real call without the key fails loudly here.
  if (!env.ZERNIO_API_KEY) {
    throw new ZernioError("ZERNIO_API_KEY is not configured.", {
      code: "NOT_CONFIGURED",
    });
  }
  return env.ZERNIO_API_KEY;
}

type RequestOptions = {
  method?: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Idempotency-Key header, derived from our entity id (§7 I2). */
  idempotencyKey?: string;
};

/** Fetch + auth + timeout + HTTP-error mapping. Returns the raw Response. */
async function rawRequest(
  path: string,
  opts: RequestOptions,
): Promise<Response> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    throw new ZernioError(
      `Zernio request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { code: "NETWORK" },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Never surface Zernio's raw body to callers; just status + a generic note.
    throw new ZernioError(`Zernio API returned ${res.status}`, {
      code: "HTTP_ERROR",
      status: res.status,
    });
  }
  return res;
}

/** rawRequest + JSON parse + zod validation of the body. */
async function request<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  opts: RequestOptions = {},
): Promise<z.infer<TSchema>> {
  const res = await rawRequest(path, opts);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ZernioError("Zernio returned a non-JSON body.", {
      code: "BAD_RESPONSE",
    });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ZernioError("Zernio response failed schema validation.", {
      code: "BAD_RESPONSE",
    });
  }
  return parsed.data;
}

/**
 * Create a Zernio profile (lazy, once per brand — ADR-009). `idempotencyKey`
 * should be derived from our brand id so a retry never creates a second
 * profile. Returns the Zernio profile id (`_id`).
 */
export async function createProfile(
  name: string,
  idempotencyKey: string,
): Promise<string> {
  const { profile } = await request("/profiles", profileCreateResponseSchema, {
    method: "POST",
    body: { name },
    idempotencyKey,
  });
  return profile._id;
}

/**
 * Get the OAuth authorize URL for a platform on a profile. `redirectUrl` is our
 * callback (best-effort — VERIFY whether Zernio honors it as a param vs. a
 * dashboard-configured callback; our flow does not depend on Zernio echoing
 * state, it uses a signed state cookie).
 */
export async function getConnectUrl(
  zernioSlug: string,
  profileId: string,
  redirectUrl?: string,
): Promise<string> {
  const { authUrl } = await request(
    `/connect/${zernioSlug}`,
    connectResponseSchema,
    { query: { profileId, redirectUrl } },
  );
  return authUrl;
}

/** List the connected accounts on a profile, normalized to our columns. */
export async function listAccounts(
  profileId: string,
): Promise<NormalizedAccount[]> {
  const { accounts } = await request("/accounts", accountsResponseSchema, {
    query: { profileId },
  });
  return accounts.map(normalizeAccount);
}

/**
 * Fetch per-account health for a profile. ⚠️ VERIFY (§3): path + shape are
 * best-effort. Returns raw health entries; callers map to status via
 * `healthToStatus`.
 */
export async function getAccountsHealth(
  profileId: string,
): Promise<AccountHealthEntry[]> {
  const { accounts } = await request(
    "/accounts/health",
    accountsHealthResponseSchema,
    { query: { profileId } },
  );
  return accounts;
}

/**
 * Disconnect a connected account (stops Zernio account-day billing). ⚠️ VERIFY
 * (§3): verb/path best-effort (DELETE /accounts/{id}). Idempotent-safe: a 404
 * for an already-removed account is swallowed so a retry, or a race with our
 * own hard-delete, doesn't fail the action.
 */
export async function disconnectAccount(
  zernioAccountId: string,
): Promise<void> {
  try {
    await rawRequest(`/accounts/${zernioAccountId}`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof ZernioError && error.status === 404) return;
    throw error;
  }
}
