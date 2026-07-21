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
import { listSocialAccounts } from "@/server/dal/accounts";
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

  const connectedPlatforms = new Set(accounts.map((a) => a.platform));
  const platforms = PLATFORM_LIST.map((p) => ({
    id: p.id,
    label: p.label,
    color: p.color,
    connected: connectedPlatforms.has(p.id),
  }));

  // This brand's uploaded media for the C4 library picker + edit-mode
  // thumbnails. Map to serving views here (publicUrl is server-only). `kind` is
  // a text column constrained to image|video — narrow it for the view.
  const libraryAssets = (await listMediaForBrand(ctx, brandId)).map(
    (asset) => ({
      id: asset.id,
      kind: asset.kind as "image" | "video",
      url: publicUrl(asset.r2Key),
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds,
      moderationStatus: asset.moderationStatus,
    }),
  );

  // Edit mode: hydrate an existing DRAFT. Cross-org / unassigned / nonexistent
  // all 404 (getDraftById); C1 only edits drafts, so a non-DRAFT post 404s too.
  let initial;
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
    // C1 only edits drafts; a non-DRAFT post is not composable here.
    if (draft.status !== "DRAFT") notFound();
    initial = {
      postId: draft.id,
      content: draft.content ?? emptyPostContent(),
    };
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
    />
  );
}
