import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/server/auth/authorize";
import { getAuthCtx, UnauthorizedError } from "@/server/auth/context";
import { NotFoundError } from "@/server/domain/errors";
import { captureError } from "@/server/services/observability";
import { ZernioError } from "@/server/services/zernio";
import {
  OAUTH_STATE_COOKIE,
  verifyState,
} from "@/server/services/zernio/oauth-state";
import { reconcileBrandAccounts } from "@/server/services/zernio/reconcile";

/**
 * OAuth callback (B3, ADR-014). Zernio redirects the browser here after the
 * user authorizes. Authoritative persistence path: verify the signed state
 * cookie (CSRF + brand correlation) → read the profile's accounts from Zernio →
 * upsert each (idempotent by zernio_account_id) → clear the cookie → redirect
 * back to the brand's Accounts page. All Zernio webhooks stay in F3.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;
  const accounts = (query: string) =>
    NextResponse.redirect(
      new URL(`/brands/${brandId}/accounts${query}`, req.url),
    );

  const cookieStore = await cookies();
  const state = verifyState(cookieStore.get(OAUTH_STATE_COOKIE)?.value);
  // Forged/expired/tampered callback, or a state for a different brand.
  if (!state || state.brandId !== brandId) {
    return accounts("?error=state");
  }

  const done = (query: string) => {
    const res = accounts(query);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  try {
    const ctx = await getAuthCtx();
    authorize(ctx, "account:connect");
    // Persist/refresh from Zernio's account list for this profile. No health
    // pull: only the just-reconnected platform is proven healthy (others keep
    // their status).
    await reconcileBrandAccounts(ctx, brandId, {
      mode: "connect",
      platform: state.platform,
    });
    return done("?connected=1");
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/auth/sign-in", req.url));
    }
    if (error instanceof NotFoundError) return done("?error=not_found");
    if (error instanceof ZernioError) return done("?error=zernio");
    captureError(error);
    return done("?error=unknown");
  }
}
