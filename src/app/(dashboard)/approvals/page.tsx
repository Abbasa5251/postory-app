import { CheckCircle2 } from "lucide-react";
import { redirect } from "next/navigation";
import type { PreviewIdentity } from "@/components/features/composer/post-preview";
import { ApprovalsFilters } from "@/components/features/approvals/approvals-filters";
import { ReviewQueue } from "@/components/features/approvals/review-queue";
import { loadApprovalFilters } from "@/components/features/approvals/search-params";
import { PageHeader } from "@/components/features/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { isPlatform, PLATFORMS, type Platform } from "@/lib/platforms/config";
import { getAuthCtx } from "@/server/auth/context";
import { can } from "@/server/auth/authorize";
import { listSocialAccountsForBrands } from "@/server/dal/accounts";
import { listBrandIdsForMember } from "@/server/dal/brand-members";
import { listBrands } from "@/server/dal/brands";
import { getMediaByIds } from "@/server/dal/media";
import { listPostsForReview, type ReviewPost } from "@/server/dal/posts";
import { toMediaAssetView } from "@/server/media-views";

/** Per-brand → per-platform preview identity (first connected account, else brand). */
type Identities = Record<string, Record<Platform, PreviewIdentity>>;

/** De-duped union of every attached media id across the queue's posts. */
function collectMediaIds(posts: ReviewPost[]): string[] {
  const ids = new Set<string>();
  for (const post of posts) {
    for (const variant of Object.values(post.content?.variants ?? {})) {
      for (const id of variant?.mediaIds ?? []) ids.add(id);
    }
  }
  return [...ids];
}

// Thin route (§5): resolve the reviewer's approvable brands, parse filters,
// scoped DAL reads, render. params/searchParams are Promises in Next 16. The
// (dashboard) layout gate guarantees getAuthCtx resolves.
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getAuthCtx();
  // Gate the whole reviewer surface server-side (§7): only the post:approve
  // roles (owner/admin/approver) may load the queue. The sidebar hides the link
  // for others; this rejects a direct navigation BEFORE any queue/brand read
  // (client-side hiding is UX sugar — the server is the boundary).
  const canApprove = can(ctx, "post:approve");
  if (!canApprove) redirect("/dashboard");

  const filters = await loadApprovalFilters(searchParams);

  // E2: reviewer visibility is scoped to the member's brand_members assignments
  // for ALL roles on this surface (not org-wide) — resolved via the B5 reader,
  // no getAuthCtx change. `approvable` (id + name) feeds both the workspace
  // dropdown and the queue's brand allowlist.
  const [assignedIds, allBrands] = await Promise.all([
    listBrandIdsForMember(ctx, ctx.memberId),
    listBrands(ctx),
  ]);
  const assigned = new Set(assignedIds);
  const approvable = allBrands.filter((b) => assigned.has(b.id));
  const brandById = new Map(approvable.map((b) => [b.id, b]));

  // Drop a hand-edited/stale workspace param that isn't an approvable brand
  // (degrade to "all"), and normalize the platform param.
  const workspace =
    filters.workspace && brandById.has(filters.workspace)
      ? filters.workspace
      : undefined;
  const platform =
    filters.platform && isPlatform(filters.platform)
      ? filters.platform
      : undefined;
  const hasFilters = Boolean(workspace || platform);

  const posts = await listPostsForReview(ctx, {
    brandIds: approvable.map((b) => b.id),
    brandId: workspace,
    platform,
  });

  // Resolve the exact media the queue references (one org-scoped read across all
  // brands), so each card renders the feed-accurate preview per platform. The id
  // set is naturally bounded by the queue itself — no artificial cap that would
  // drop a post's own media (keyset pagination of the queue is a later follow-up).
  const mediaAssets = (await getMediaByIds(ctx, collectMediaIds(posts))).map(
    toMediaAssetView,
  );

  // Per-platform preview identity, keyed by brand: the first connected account's
  // handle/avatar, falling back to the brand logo/name (mirrors the composer/E1).
  const queueBrandIds = [...new Set(posts.map((p) => p.brandId))];
  const accounts = await listSocialAccountsForBrands(ctx, queueBrandIds);
  const firstAccount = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    const key = `${account.brandId}:${account.platform}`;
    if (!firstAccount.has(key)) firstAccount.set(key, account);
  }
  const identities: Identities = {};
  for (const brandId of queueBrandIds) {
    const brand = brandById.get(brandId);
    const perPlatform = {} as Record<Platform, PreviewIdentity>;
    for (const platformId of PLATFORMS) {
      const account = firstAccount.get(`${brandId}:${platformId}`);
      perPlatform[platformId] = {
        handle: account?.handle ?? null,
        avatarUrl: account?.avatarUrl ?? brand?.logoUrl ?? null,
        name: brand?.name ?? "",
      } satisfies PreviewIdentity;
    }
    identities[brandId] = perPlatform;
  }

  const count = posts.length;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Approvals"
        description={
          count === 0
            ? "Posts submitted for internal review in the brands you manage."
            : `${count} post${count === 1 ? "" : "s"} waiting on your review before they can publish.`
        }
        actions={
          <ApprovalsFilters
            brands={approvable.map(({ id, name }) => ({ id, name }))}
          />
        }
      />
      {count === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="size-5" />}
          title={
            approvable.length === 0
              ? "No brands assigned"
              : hasFilters
                ? "No matching posts"
                : "Nothing to review"
          }
          description={
            approvable.length === 0
              ? "You’re not assigned to any brand yet. An owner or admin can add you from a brand’s Access section."
              : hasFilters
                ? "No posts match these filters. Clear them to see everything."
                : "Posts submitted for approval will show up here."
          }
        />
      ) : (
        <ReviewQueue
          posts={posts}
          mediaAssets={mediaAssets}
          identities={identities}
          // Always true past the page gate above; the mutating actions
          // (approvePost/requestChanges) still re-enforce post:approve server-side.
          canApprove={canApprove}
        />
      )}
    </div>
  );
}
