import { Link2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import * as z from "zod";
import { Composer } from "@/components/features/composer/composer";
import { PageHeader } from "@/components/features/shell/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PLATFORM_LIST } from "@/lib/platforms/config";
import { emptyPostContent } from "@/lib/validation/posts";
import { can } from "@/server/auth/authorize";
import { listApprovalsForPost } from "@/server/dal/approvals";
import { listSocialAccounts } from "@/server/dal/accounts";
import { listBrandMembers } from "@/server/dal/brand-members";
import { listCommentsForPost, type CommentView } from "@/server/dal/comments";
import { listMediaForBrand } from "@/server/dal/media";
import { getDraftById } from "@/server/dal/posts";
import { NotFoundError } from "@/server/domain/errors";
import { publicUrl } from "@/server/services/storage";
import { requireBrand } from "../_lib/require-brand";

// Thin route (§5): scoped DAL reads + render. params/searchParams are Promises
// in Next 16.
export default async function ComposerPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
  const { brandId } = await params;
  const { post: postId } = await searchParams;
  const { ctx, brand } = await requireBrand(brandId);

  const accounts = await listSocialAccounts(ctx, brandId);
  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="New post"
          description={`Drafting for ${brand.name}.`}
        />
        <EmptyState
          icon={<Link2 className="size-5" />}
          title="Connect an account first"
          description="The composer publishes to a brand's connected social accounts. Connect at least one to start drafting."
          action={
            <Button render={<Link href={`/brands/${brandId}/accounts`} />}>
              Go to Connections
            </Button>
          }
        />
      </div>
    );
  }

  // First connected account per platform — its real handle/avatar give the C5
  // preview a feed-accurate identity (a platform can hold several accounts;
  // the preview attributes to one, so pick the first).
  const accountByPlatform = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    if (!accountByPlatform.has(account.platform))
      accountByPlatform.set(account.platform, account);
  }
  const platforms = PLATFORM_LIST.map((p) => {
    const account = accountByPlatform.get(p.id);
    return {
      id: p.id,
      label: p.label,
      color: p.color,
      connected: accountByPlatform.has(p.id),
      handle: account?.handle,
      avatarUrl: account?.avatarUrl ?? null,
    };
  });

  // This brand's uploaded media for the C4 library picker + edit-mode
  // thumbnails. Map to serving views here (publicUrl is server-only). `kind` is
  // a text column constrained to image|video — narrow it for the view. Bound the
  // initial payload (most recent first); full search/pagination is D4.
  const LIBRARY_PAGE_SIZE = 60;
  const libraryAssets = (
    await listMediaForBrand(ctx, brandId, { limit: LIBRARY_PAGE_SIZE })
  ).map((asset) => ({
    id: asset.id,
    kind: asset.kind as "image" | "video",
    url: publicUrl(asset.r2Key),
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    moderationStatus: asset.moderationStatus,
  }));

  // Edit mode: hydrate an existing DRAFT. Cross-org / unassigned / nonexistent
  // all 404 (getDraftById). E1: the composer edits DRAFT + CHANGES_REQUESTED
  // (editing a rejected post reverts it to DRAFT on save, §5); other statuses
  // are locked here.
  let initial;
  let changeRequest: { note: string | null; by: string | null } | null = null;
  // E3: a saved post carries a comment thread + the org member list (mention
  // typeahead). Loaded only in edit mode — a brand-new draft has no post yet.
  let comments: CommentView[] = [];
  let members: { id: string; name: string }[] = [];
  if (postId) {
    // A malformed id would reach getDraftById's uuid column and throw a DB
    // error, not a NotFoundError — treat it as a not-found (404) before the query.
    if (!z.uuid().safeParse(postId).success) notFound();
    let draft;
    try {
      draft = await getDraftById(ctx, postId);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }
    if (draft.status !== "DRAFT" && draft.status !== "CHANGES_REQUESTED") {
      notFound();
    }
    initial = {
      postId: draft.id,
      content: draft.content ?? emptyPostContent(),
    };
    // Surface the latest changes-requested note so the creator sees what to fix.
    if (draft.status === "CHANGES_REQUESTED") {
      const history = await listApprovalsForPost(ctx, draft.id);
      const latest = history.find((a) => a.decision === "changes_requested");
      if (latest) {
        changeRequest = { note: latest.note, by: latest.decidedByName };
      }
    }
    comments = await listCommentsForPost(ctx, draft.id);
    // E3 @mention picker: members ASSIGNED to this brand (not org-wide), so you
    // only mention people who work on — and can open — this brand's posts.
    members = await listBrandMembers(ctx, brandId);
  }

  return (
    <Composer
      brandId={brandId}
      brandName={brand.name}
      timezone={brand.timezone}
      platforms={platforms}
      initial={initial}
      // B2 stores null when the voice profile is all-empty, so a non-null value
      // means the brand has guidance the AI will apply (C2).
      hasVoiceProfile={Boolean(brand.voiceProfile)}
      libraryAssets={libraryAssets}
      brandLogoUrl={brand.logoUrl}
      changeRequest={changeRequest}
      comments={comments}
      members={members}
      canComment={can(ctx, "post:create")}
    />
  );
}
