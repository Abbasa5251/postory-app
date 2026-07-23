import { CheckCircle2 } from "lucide-react";
import type { PreviewIdentity } from "@/components/features/composer/post-preview";
import { ReviewQueue } from "@/components/features/approvals/review-queue";
import { PageHeader } from "@/components/features/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PLATFORM_LIST, type Platform } from "@/lib/platforms/config";
import { listSocialAccounts } from "@/server/dal/accounts";
import { can } from "@/server/auth/authorize";
import { listMediaForBrand } from "@/server/dal/media";
import { listPostsForReview } from "@/server/dal/posts";
import { toMediaAssetView } from "@/server/media-views";
import { requireBrand } from "../_lib/require-brand";

// Thin route (§5): scoped DAL reads + render. E1 reviewer surface; E2 adds the
// filtered cross-brand "needs my approval" queue.
export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { ctx, brand } = await requireBrand(brandId);

  const posts = await listPostsForReview(ctx, brandId);
  // Resolve the brand's media so each card renders the full feed-accurate
  // preview per platform (a reviewer signs off on what will actually ship).
  // Bounded like the composer's library payload.
  const mediaAssets = (
    await listMediaForBrand(ctx, brandId, { limit: 200 })
  ).map(toMediaAssetView);

  // Per-platform preview identity (mirrors the composer page): the first
  // connected account's handle/avatar, falling back to the brand logo/name, so
  // the C5 PostPreview attributes the post to the real account.
  const accounts = await listSocialAccounts(ctx, brandId);
  const accountByPlatform = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    if (!accountByPlatform.has(account.platform))
      accountByPlatform.set(account.platform, account);
  }
  const identities = Object.fromEntries(
    PLATFORM_LIST.map((p) => {
      const account = accountByPlatform.get(p.id);
      return [
        p.id,
        {
          handle: account?.handle ?? null,
          avatarUrl: account?.avatarUrl ?? brand.logoUrl ?? null,
          name: brand.name,
        } satisfies PreviewIdentity,
      ];
    }),
  ) as Record<Platform, PreviewIdentity>;

  // UX gate only — approvePost/requestChanges re-enforce post:approve server-side.
  const canApprove = can(ctx, "post:approve");

  const count = posts.length;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description={
          count === 0
            ? "Posts submitted for internal review."
            : `${count} post${count === 1 ? "" : "s"} waiting on your review before they can publish.`
        }
      />
      {count === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-5" />}
          title="Nothing to review"
          description="Posts submitted for approval will show up here."
        />
      ) : (
        <ReviewQueue
          posts={posts}
          brandName={brand.name}
          mediaAssets={mediaAssets}
          identities={identities}
          canApprove={canApprove}
        />
      )}
    </div>
  );
}
