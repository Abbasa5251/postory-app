import Link from "next/link";
import { notFound } from "next/navigation";
import {
  type AccessMember,
  BrandAccessSection,
} from "@/components/features/brands/brand-access-section";
import { BrandContactForm } from "@/components/features/brands/brand-contact-form";
import { BrandVoiceForm } from "@/components/features/brands/brand-voice-form";
import { EditBrandForm } from "@/components/features/brands/edit-brand-form";
import { Separator } from "@/components/ui/separator";
import { type VoiceProfile, voiceProfileSchema } from "@/lib/validation/brands";
import { getAuthCtx } from "@/server/auth/context";
import { listBrandMemberIds } from "@/server/dal/brand-members";
import { getBrandById } from "@/server/dal/brands";
import { listOrgMembers } from "@/server/dal/org";
import { NotFoundError } from "@/server/domain/errors";

// Thin route (§5): scoped DAL read + render. `params` is a Promise in Next 16.
export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const ctx = await getAuthCtx();

  let brand;
  try {
    brand = await getBrandById(ctx, brandId);
  } catch (error) {
    // Cross-org / unassigned / nonexistent are all the same 404 shape (§7).
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Editing is owner/admin only; other roles that can read a brand see it
  // read-only. Enforcement is server-side in the update actions (§7).
  const canEdit = ctx.role === "owner" || ctx.role === "admin";

  // Brand Assignment (B5) is owner/admin only, so only fetch the roster then.
  // Both reads are org-scoped by ctx (§6); an agency has ≤10 seats (D1), so the
  // whole team is one read.
  let access: {
    members: AccessMember[];
    assignedMemberIds: string[];
  } | null = null;
  if (canEdit) {
    const [members, assignedMemberIds] = await Promise.all([
      listOrgMembers(ctx),
      listBrandMemberIds(ctx, brand.id),
    ]);
    access = {
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
      assignedMemberIds,
    };
  }

  // Read the opaque JSONB back through the schema so the form gets a clean,
  // typed value (null for empty/legacy data).
  const parsedVoice = voiceProfileSchema.safeParse(brand.voiceProfile);
  const voiceProfile = parsedVoice.success ? parsedVoice.data : null;

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/brands"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Brands
        </Link>
        <h1 className="font-heading text-2xl font-semibold">{brand.name}</h1>
        <Link
          href={`/brands/${brand.id}/accounts`}
          className="text-sm text-muted-foreground hover:underline"
        >
          Accounts →
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-medium">Details</h2>
        {canEdit ? (
          <EditBrandForm
            brand={{ id: brand.id, name: brand.name, timezone: brand.timezone }}
          />
        ) : (
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd>{brand.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd>{brand.timezone}</dd>
            </div>
          </dl>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-medium">Voice profile</h2>
        {canEdit ? (
          <BrandVoiceForm brand={{ id: brand.id, voiceProfile }} />
        ) : (
          <ReadOnlyVoice voiceProfile={voiceProfile} />
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-medium">Client contact</h2>
        {canEdit ? (
          <BrandContactForm
            brand={{
              id: brand.id,
              clientContactEmail: brand.clientContactEmail,
            }}
          />
        ) : (
          <dl className="text-sm">
            <dt className="text-muted-foreground">Client contact email</dt>
            <dd>{brand.clientContactEmail ?? "—"}</dd>
          </dl>
        )}
      </section>

      {access && (
        <>
          <Separator />
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-lg font-medium">Access</h2>
              <p className="text-sm text-muted-foreground">
                Creators see only the brands they&apos;re assigned to. Owners,
                admins, and approvers see every brand.
              </p>
            </div>
            <BrandAccessSection
              brandId={brand.id}
              members={access.members}
              assignedMemberIds={access.assignedMemberIds}
            />
          </section>
        </>
      )}
    </div>
  );
}

function ReadOnlyVoice({
  voiceProfile,
}: {
  voiceProfile: VoiceProfile | null;
}) {
  if (!voiceProfile) {
    return (
      <p className="text-sm text-muted-foreground">No voice profile set.</p>
    );
  }
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Tone</dt>
        <dd>{voiceProfile.tone || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Banned words</dt>
        <dd>{voiceProfile.bannedWords?.join(", ") || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Hashtags</dt>
        <dd>{voiceProfile.hashtags?.map((h) => `#${h}`).join(" ") || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Sample posts</dt>
        <dd>{voiceProfile.samplePosts?.length ?? 0} saved</dd>
      </div>
    </dl>
  );
}
