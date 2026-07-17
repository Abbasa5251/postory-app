import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { member } from "./auth";
import { createdAt, memberRef, orgId, timestamps, uuidV7Pk } from "./_helpers";

/**
 * brands (PRD §4) — one client workspace per brand. The tenancy unit below
 * the org: everything content-related hangs off a brand.
 */
export const brands = pgTable(
  "brands",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // AGENTS.md §9: schedule with the brand's IANA timezone.
    timezone: text("timezone").notNull().default("UTC"),
    logoUrl: text("logo_url"),
    // Opaque — brand palette, shaped by B1/E4 (portal theming).
    colors: jsonb("colors"),
    // Opaque — tone, banned words, hashtag sets, sample posts (B2/C2).
    voiceProfile: jsonb("voice_profile"),
    // D2: per-brand client-approval toggle; adds the CLIENT_REVIEW state.
    requiresClientApproval: boolean("requires_client_approval")
      .notNull()
      .default(false),
    // B2: recipient of approval-request and report links (portal magic links).
    clientContactEmail: text("client_contact_email"),
    ...timestamps(),
  },
  (t) => [
    // Composite FK target: children reference (org_id, id) so their
    // denormalized org_id provably matches the brand's org (§6
    // belt-and-suspenders — a wrong org_id can't slip past a brand FK).
    unique("brands_org_id_id_key").on(t.orgId, t.id),
    uniqueIndex("brands_org_slug_uidx").on(t.orgId, t.slug),
    index("brands_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * zernio_profiles (ADR-009, re-amended after R1 resolved) — brand ↔ Zernio
 * profile is 1:1. Zernio's own docs frame a profile as a "tenant boundary"
 * container that holds any number of accounts (including multiples of the same
 * platform), so a brand needs exactly one profile — no overflow profiles. The
 * single profile is provisioned LAZILY on first account placement (B3), not at
 * brand creation (B1): a brand with no connected accounts has no row here.
 * Invisible to users.
 */
export const zernioProfiles = pgTable(
  "zernio_profiles",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    // External Zernio id — one Zernio workspace key for all of POSTORY,
    // so this is globally unique, not per-org.
    zernioProfileId: text("zernio_profile_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    // Composite FK target for social_accounts' same-brand proof.
    unique("zernio_profiles_brand_id_id_key").on(t.brandId, t.id),
    // Composite FK: the profile's brand must belong to the profile's org (§6).
    foreignKey({
      name: "zernio_profiles_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    // 1:1 (ADR-009 re-amended): at most one Zernio profile per brand.
    uniqueIndex("zernio_profiles_brand_uidx").on(t.brandId),
    uniqueIndex("zernio_profiles_external_uidx").on(t.zernioProfileId),
    index("zernio_profiles_org_brand_idx").on(t.orgId, t.brandId),
  ],
);

/**
 * social_accounts (PRD §4) — a connected platform account, placed on one of
 * the brand's Zernio profiles. 6 launch platforms (D3); `youtube` covers
 * Shorts (a format, not a platform).
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    zernioProfileId: uuid("zernio_profile_id").notNull(),
    platform: text("platform").notNull(),
    zernioAccountId: text("zernio_account_id").notNull(),
    handle: text("handle").notNull(),
    avatarUrl: text("avatar_url"),
    // B3 connection health: `connected` (posting-capable) or `needs_reauth`
    // (fires the Reconnect prompt), derived from Zernio's account health.
    // Disconnect is a hard delete (row removed), not a status — so there is no
    // `disconnected` value; reconnecting re-runs the connect flow.
    status: text("status").notNull().default("connected"),
    connectedBy: memberRef("connected_by"),
    ...timestamps(),
  },
  (t) => [
    check(
      "social_accounts_platform_check",
      sql`${t.platform} IN ('instagram', 'facebook', 'tiktok', 'linkedin', 'threads', 'youtube')`,
    ),
    check(
      "social_accounts_status_check",
      sql`${t.status} IN ('connected', 'needs_reauth')`,
    ),
    // Composite FK targets for post_platforms' same-org/same-brand proofs.
    unique("social_accounts_org_id_id_key").on(t.orgId, t.id),
    unique("social_accounts_brand_id_id_key").on(t.brandId, t.id),
    // Composite FKs: the account's brand must belong to its org, and its
    // Zernio profile must belong to that same brand (§6).
    foreignKey({
      name: "social_accounts_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "social_accounts_brand_profile_fkey",
      columns: [t.brandId, t.zernioProfileId],
      foreignColumns: [zernioProfiles.brandId, zernioProfiles.id],
    }).onDelete("cascade"),
    // ADR-009 (re-amended, R1 resolved): a brand's single profile MAY hold
    // more than one account of the same platform, so there is no
    // (zernio_profile_id, platform) uniqueness. Identity is the Zernio account.
    uniqueIndex("social_accounts_zernio_account_uidx").on(t.zernioAccountId),
    index("social_accounts_org_brand_idx").on(t.orgId, t.brandId),
  ],
);

/**
 * brand_members (PRD §4, B5) — creator brand scoping. Resolved into
 * AuthCtx.brandIds by getAuthCtx() once B5 lands.
 */
export const brandMembers = pgTable(
  "brand_members",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id").notNull(),
    // Pure join row — dies with the membership (cascade, unlike the
    // attribution FKs elsewhere which SET NULL). member_id ↔ org consistency
    // stays DAL-enforced: a composite FK would need a unique key on the
    // better-auth-owned member table (§6) — flagged in PR notes.
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Composite FK: the assigned brand must belong to this org (§6).
    foreignKey({
      name: "brand_members_org_brand_fkey",
      columns: [t.orgId, t.brandId],
      foreignColumns: [brands.orgId, brands.id],
    }).onDelete("cascade"),
    uniqueIndex("brand_members_brand_member_uidx").on(t.brandId, t.memberId),
    index("brand_members_org_member_idx").on(t.orgId, t.memberId),
  ],
);

export const brandsRelations = defineRelationsPart(
  { brands, zernioProfiles, socialAccounts, brandMembers, member },
  (r) => ({
    brands: {
      // 1:1 (ADR-009 re-amended): a brand has exactly one Zernio profile.
      zernioProfile: r.one.zernioProfiles({
        from: r.brands.id,
        to: r.zernioProfiles.brandId,
      }),
      socialAccounts: r.many.socialAccounts({
        from: r.brands.id,
        to: r.socialAccounts.brandId,
      }),
      brandMembers: r.many.brandMembers({
        from: r.brands.id,
        to: r.brandMembers.brandId,
      }),
    },
    zernioProfiles: {
      brand: r.one.brands({
        from: r.zernioProfiles.brandId,
        to: r.brands.id,
      }),
      socialAccounts: r.many.socialAccounts({
        from: r.zernioProfiles.id,
        to: r.socialAccounts.zernioProfileId,
      }),
    },
    socialAccounts: {
      brand: r.one.brands({
        from: r.socialAccounts.brandId,
        to: r.brands.id,
      }),
      zernioProfile: r.one.zernioProfiles({
        from: r.socialAccounts.zernioProfileId,
        to: r.zernioProfiles.id,
      }),
    },
    brandMembers: {
      brand: r.one.brands({
        from: r.brandMembers.brandId,
        to: r.brands.id,
      }),
      member: r.one.member({
        from: r.brandMembers.memberId,
        to: r.member.id,
      }),
    },
  }),
);
