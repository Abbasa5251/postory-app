import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProfile,
  disconnectAccount,
  getConnectUrl,
  listAccounts,
} from "@/server/services/zernio/client";
import { ZernioError } from "@/server/services/zernio/errors";

/**
 * Seam C (Zernio service client): the HTTP boundary is mocked; we assert the
 * request SHAPE (path, query, auth header, idempotency key, body) and the
 * response parsing / error mapping through the zod schemas. No network.
 */

const fetchMock = vi.fn();

// t3-env snapshots process.env at import, so stubEnv doesn't reach it; mock the
// env module with a mutable key (the codebase's vi.hoisted pattern, cf. @/db/db).
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { ZERNIO_API_KEY: "test-key" as string | undefined },
}));
vi.mock("@/lib/env/server", () => ({ env: mockEnv }));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  mockEnv.ZERNIO_API_KEY = "test-key";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The (url, init) of the single fetch call. */
function lastCall() {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  return { url: url.toString(), init };
}

describe("createProfile", () => {
  it("POSTs /profiles with name body, bearer auth, idempotency key; returns _id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ profile: { _id: "zp_1" } }));
    const id = await createProfile("Acme", "brand_1");
    expect(id).toBe("zp_1");

    const { url, init } = lastCall();
    expect(url).toBe("https://zernio.com/api/v1/profiles");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("brand_1");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme" });
  });
});

describe("getConnectUrl", () => {
  it("GETs /connect/{slug} with profileId + redirectUrl and returns authUrl", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ authUrl: "https://instagram.com/oauth?x=1" }),
    );
    const authUrl = await getConnectUrl("instagram", "zp_1", "https://app/cb");
    expect(authUrl).toBe("https://instagram.com/oauth?x=1");

    const { url } = lastCall();
    expect(url).toContain("https://zernio.com/api/v1/connect/instagram");
    expect(url).toContain("profileId=zp_1");
    expect(url).toContain("redirectUrl=https%3A%2F%2Fapp%2Fcb");
  });
});

describe("listAccounts", () => {
  it("normalizes the accounts array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        accounts: [
          { _id: "a1", platform: "instagram", username: "@acme" },
          {
            _id: "a2",
            platform: "tiktok",
            profilePicture: "http://img",
          },
        ],
        hasAnalyticsAccess: false,
      }),
    );
    const accounts = await listAccounts("zp_1");
    expect(accounts).toEqual([
      {
        zernioAccountId: "a1",
        platform: "instagram",
        handle: "@acme",
        avatarUrl: null,
      },
      {
        zernioAccountId: "a2",
        platform: "tiktok",
        handle: "a2",
        avatarUrl: "http://img",
      },
    ]);
    expect(lastCall().url).toContain("profileId=zp_1");
  });
});

describe("error mapping", () => {
  it("throws NOT_CONFIGURED when the API key is unset", async () => {
    mockEnv.ZERNIO_API_KEY = undefined;
    await expect(listAccounts("zp_1")).rejects.toMatchObject({
      name: "ZernioError",
      code: "NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to ZernioError with the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    await expect(listAccounts("zp_1")).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 500,
    });
  });

  it("maps a schema-invalid body to BAD_RESPONSE", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ wrong: "shape" }));
    await expect(listAccounts("zp_1")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("maps a network failure to ZernioError NETWORK", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(listAccounts("zp_1")).rejects.toMatchObject({
      code: "NETWORK",
    });
  });
});

describe("disconnectAccount", () => {
  it("DELETEs /accounts/{id}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 200));
    await disconnectAccount("a1");
    const { url, init } = lastCall();
    expect(url).toBe("https://zernio.com/api/v1/accounts/a1");
    expect(init.method).toBe("DELETE");
  });

  it("swallows a 404 (already disconnected) but rethrows other errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 404));
    await expect(disconnectAccount("a1")).resolves.toBeUndefined();

    fetchMock.mockResolvedValue(jsonResponse({}, 500));
    await expect(disconnectAccount("a1")).rejects.toBeInstanceOf(ZernioError);
  });
});
