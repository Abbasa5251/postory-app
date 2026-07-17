import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env/server";
import { getPlatformConfig } from "@/lib/platforms/config";
import { authorize } from "@/server/auth/authorize";
import { getAuthCtx, UnauthorizedError } from "@/server/auth/context";
import {
  createZernioProfile,
  getZernioProfileByBrand,
} from "@/server/dal/accounts";
import { getBrandById } from "@/server/dal/brands";
import { NotFoundError } from "@/server/domain/errors";
import { captureError } from "@/server/services/observability";
import {
  createProfile,
  getConnectUrl,
  ZernioError,
} from "@/server/services/zernio";
import {
  createState,
  OAUTH_STATE_COOKIE,
} from "@/server/services/zernio/oauth-state";

/**
 * Connect-init (B3, ADR-014 interactive-OAuth carve-out from ADR-003). POST —
 * not a prefetchable GET, so a link prefetch can never provision a Zernio
 * profile. §7 pipeline: validate platform → authenticate → authorize
 * (account:connect) → scoped fetch (brand) → lazily provision the brand's
 * single Zernio profile → get the authUrl → set a signed state cookie →
 * redirect the browser to Zernio's consent screen.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;
  // 303 See Other: this is a POST handler, so every redirect must switch the
  // browser to GET (307/308 would replay the POST against the target).
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(`/brands/${brandId}/accounts?error=${code}`, req.url),
      303,
    );

  const platformId = req.nextUrl.searchParams.get("platform") ?? "";
  const platform = getPlatformConfig(platformId);
  if (!platform) return back("platform");

  try {
    const ctx = await getAuthCtx();
    authorize(ctx, "account:connect");
    const brand = await getBrandById(ctx, brandId); // scoped 404 (§7 step 4)

    // Lazily provision the brand's single Zernio profile (ADR-009). Idempotent:
    // reuse the existing row; the create call keys idempotency on our brand id.
    let profile = await getZernioProfileByBrand(ctx, brandId);
    if (!profile) {
      const zernioProfileId = await createProfile(brand.name, brand.id);
      profile = await createZernioProfile(ctx, brandId, zernioProfileId);
    }

    const callbackUrl = `${env.BETTER_AUTH_URL}/api/brands/${brandId}/accounts/callback`;
    const authUrl = await getConnectUrl(
      platform.zernioSlug,
      profile.zernioProfileId,
      callbackUrl,
    );

    const res = NextResponse.redirect(authUrl, 303);
    res.cookies.set(
      OAUTH_STATE_COOKIE,
      createState({
        brandId,
        profileId: profile.zernioProfileId,
        platform: platform.id,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 600,
      },
    );
    return res;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/auth/sign-in", req.url), 303);
    }
    // Cross-org / unassigned / nonexistent brand → same 404-shaped path (§7).
    if (error instanceof NotFoundError) return back("not_found");
    if (error instanceof ZernioError) return back("zernio");
    captureError(error);
    return back("unknown");
  }
}
