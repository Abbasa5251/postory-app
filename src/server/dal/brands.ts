import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/db";
import { brands } from "@/db/schemas/brands";
import type { OrgAuditEvent } from "@/lib/validation/audit";
import type { CreateBrandInput, VoiceProfile } from "@/lib/validation/brands";
import { dedupeSlug, slugify } from "@/server/domain/brand-slug";
import { NotFoundError } from "@/server/domain/errors";
import { buildAuditInsert, recordAuditEvent } from "./audit";
import { assertBrandAccess, brandScope, orgScope } from "./scope";
import type { AuthCtx } from "./types";

/**
 * Brands DAL — the reference org-scoped module (AGENTS.md §6): mandatory
 * ctx first argument, orgScope in every where-clause, brand narrowing for
 * creators, cross-org reads indistinguishable from not-found.
 *
 * Reads landed in A5; B1 adds the mutations, each pairing its write with the
 * audit template in dal/audit.ts.
 */

/** All brands the caller can see: org-scoped, narrowed to assigned brands for creators. */
export async function listBrands(ctx: AuthCtx) {
  return db
    .select()
    .from(brands)
    .where(and(orgScope(ctx, brands), brandScope(ctx, brands.id)))
    .orderBy(brands.name);
}

/**
 * One brand by id. Throws NotFoundError for nonexistent, cross-org and
 * unassigned-to-creator alike (AGENTS.md §7 — same 404 shape).
 */
export async function getBrandById(ctx: AuthCtx, brandId: string) {
  assertBrandAccess(ctx, brandId);
  const [row] = await db
    .select()
    .from(brands)
    .where(and(orgScope(ctx, brands), eq(brands.id, brandId)))
    .limit(1);
  if (!row) {
    throw new NotFoundError("brand", brandId);
  }
  return row;
}

/**
 * Create a brand in the caller's org (B1). Role is gated upstream by
 * authorize("brand:create"); this method owns tenancy + the audit pairing.
 *
 * The slug is auto-derived from the name and de-duplicated within the org
 * (immutable thereafter — routing is by id, B1 grill). org_id is written from
 * the ctx, never from input. No Zernio work: the Zernio profile is provisioned
 * lazily on first account placement (ADR-009, amended).
 *
 * TODO(B4): entitlement/plan-cap check (trial: 2 brands, plan caps) — owned by
 * entitlements.ts, which doesn't exist yet. This method enforces WHO (via the
 * action's authorize gate) but not HOW MANY.
 */
export async function createBrand(ctx: AuthCtx, input: CreateBrandInput) {
  const taken = await db
    .select({ slug: brands.slug })
    .from(brands)
    .where(orgScope(ctx, brands));
  // Best-effort dedupe: the `(org_id, slug)` unique index is the real backstop
  // (a concurrent same-name create loses the race and surfaces as an error
  // rather than a duplicate). Fine for B1 — the slug is cosmetic, routing is
  // by id.
  const slug = dedupeSlug(
    slugify(input.name),
    taken.map((r) => r.slug),
  );

  // Case B (dal/audit.ts): uuidv7() id is DB-generated, so batch can't
  // reference it — insert, then audit with the returned id.
  const [row] = await db
    .insert(brands)
    .values({
      orgId: ctx.orgId,
      name: input.name,
      slug,
      timezone: input.timezone,
    })
    .returning();
  if (!row) throw new Error("brand insert returned no row");
  await recordAuditEvent(ctx, {
    action: "brand.create",
    entityType: "brand",
    entityId: row.id,
    // Diff of what was created (§6.6) — from the validated input + computed
    // slug, so it's populated regardless of which columns `.returning()` yields.
    metadata: { name: input.name, slug, timezone: input.timezone },
  });
  return row;
}

/** The columns a brand update may set. `slug` is absent — it's immutable. */
type BrandUpdateFields = Partial<{
  name: string;
  timezone: string;
  voiceProfile: VoiceProfile | null;
  clientContactEmail: string | null;
}>;

/**
 * Shared atomic brand-update mechanism (B1.2/B2) — the §13 hotspot every brand
 * mutation funnels through. Role is gated upstream by authorize("brand:update")
 * and the action does the §7 step-4 scoped fetch (getBrandById), so
 * cross-org/nonexistent ids 404 before any write; the org+id scope here is
 * belt-and-suspenders (§6.4). Case A (dal/audit.ts): the id is known up-front,
 * so the update and its audit run as one atomic db.batch.
 */
async function applyBrandUpdate(
  ctx: AuthCtx,
  brandId: string,
  set: BrandUpdateFields,
  audit: { action: string; metadata?: OrgAuditEvent["metadata"] },
) {
  assertBrandAccess(ctx, brandId);
  const [updated] = await db.batch([
    db
      .update(brands)
      .set(set)
      .where(and(orgScope(ctx, brands), eq(brands.id, brandId)))
      .returning({ id: brands.id }),
    buildAuditInsert(ctx, {
      action: audit.action,
      entityType: "brand",
      entityId: brandId,
      metadata: audit.metadata,
    }),
  ]);
  // 0 rows: a genuine race (deleted between the scoped fetch and here) — the
  // accepted Case-A residual leaves a no-op audit row.
  if (updated.length === 0) throw new NotFoundError("brand", brandId);
  return updated[0];
}

/** Update a brand's name + timezone (B1.2). */
export async function updateBrand(
  ctx: AuthCtx,
  brandId: string,
  input: CreateBrandInput,
) {
  return applyBrandUpdate(
    ctx,
    brandId,
    { name: input.name, timezone: input.timezone },
    {
      action: "brand.update",
      metadata: { name: input.name, timezone: input.timezone },
    },
  );
}

/**
 * Set a brand's voice profile (B2). Stored as-is (already normalized + validated
 * by the schema) or null when empty. Audit records only which fields were set —
 * not the bulky values (§6.6).
 */
export async function updateBrandVoice(
  ctx: AuthCtx,
  brandId: string,
  voiceProfile: VoiceProfile | null,
) {
  const fields = voiceProfile
    ? Object.entries(voiceProfile)
        .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
        .map(([k]) => k)
    : [];
  return applyBrandUpdate(
    ctx,
    brandId,
    { voiceProfile },
    { action: "brand.voice.update", metadata: { fields } },
  );
}

/**
 * Set or clear a brand's client contact email (B2). Audit records only whether
 * it was set or cleared — never the address, which is third-party PII (§7).
 */
export async function updateBrandContact(
  ctx: AuthCtx,
  brandId: string,
  clientContactEmail: string | null,
) {
  return applyBrandUpdate(
    ctx,
    brandId,
    { clientContactEmail },
    {
      action: "brand.contact.update",
      metadata: { clientContactEmail: clientContactEmail ? "set" : "cleared" },
    },
  );
}
