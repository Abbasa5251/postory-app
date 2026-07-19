import { notFound } from "next/navigation";
import {
  type AccessMember,
  BrandAccessSection,
} from "@/components/features/brands/brand-access-section";
import { BrandContactForm } from "@/components/features/brands/brand-contact-form";
import { BrandVoiceForm } from "@/components/features/brands/brand-voice-form";
import { EditBrandForm } from "@/components/features/brands/edit-brand-form";
import { PageHeader } from "@/components/features/shell/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { brandAccent, brandInitial } from "@/lib/brand-accent";
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
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Workspace settings"
        description={`Identity, timezone, and brand voice for ${brand.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl font-heading text-xl font-bold text-white"
              style={{ background: brandAccent(brand.id) }}
            >
              {brandInitial(brand.name)}
            </span>
            <div className="flex flex-col gap-1.5">
              {/* Logo upload rides the media pipeline (Epic D) — placeholder for now. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                className="w-fit"
                title="Coming soon"
              >
                Change logo
              </Button>
              <span className="text-xs text-muted-foreground">
                Square PNG or SVG, at least 128×128
              </span>
            </div>
          </div>

          {canEdit ? (
            <EditBrandForm
              brand={{
                id: brand.id,
                name: brand.name,
                timezone: brand.timezone,
              }}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brand voice</CardTitle>
          <CardDescription>
            The AI writes every caption against this profile. The closer it
            matches how the client actually talks, the less editing you&apos;ll
            do.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <BrandVoiceForm brand={{ id: brand.id, voiceProfile }} />
          ) : (
            <ReadOnlyVoice voiceProfile={voiceProfile} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client contact</CardTitle>
          <CardDescription>
            Where approval requests and monthly report links are sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {access && (
        <Card>
          <CardHeader>
            <CardTitle>Access</CardTitle>
            <CardDescription>
              Creators see only the brands they&apos;re assigned to. Owners,
              admins, and approvers see every brand.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandAccessSection
              brandId={brand.id}
              members={access.members}
              assignedMemberIds={access.assignedMemberIds}
            />
          </CardContent>
        </Card>
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
