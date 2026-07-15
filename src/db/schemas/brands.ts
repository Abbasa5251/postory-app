import { defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
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
    uniqueIndex("brands_org_slug_uidx").on(t.orgId, t.slug),
    index("brands_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * zernio_profiles (ADR-009) — brand ↔ Zernio profile is 1:N. Each brand owns
 * a primary profile (profile_no 1); connecting a second account of an
 * already-connected platform auto-creates an overflow profile (2, 3, …).
 * Invisible to users. Remove the overflow codepath if R1 verification shows
 * multiple same-platform accounts per profile are allowed.
 */
export const zernioProfiles = pgTable(
  "zernio_profiles",
  {
    id: uuidV7Pk(),
    orgId: orgId(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    // External Zernio id — one Zernio workspace key for all of POSTORY,
    // so this is globally unique, not per-org.
    zernioProfileId: text("zernio_profile_id").notNull(),
    profileNo: integer("profile_no").notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("zernio_profiles_brand_no_uidx").on(t.brandId, t.profileNo),
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
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    zernioProfileId: uuid("zernio_profile_id")
      .notNull()
      .references(() => zernioProfiles.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    zernioAccountId: text("zernio_account_id").notNull(),
    handle: text("handle").notNull(),
    avatarUrl: text("avatar_url"),
    // B3 connection health + ADR-010 trial expiry: disconnect is a status
    // flip, the row is retained for one-click reconnect.
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
      sql`${t.status} IN ('connected', 'needs_reauth', 'disconnected')`,
    ),
    // ADR-009: one account per platform per profile (pending R1 verification).
    uniqueIndex("social_accounts_profile_platform_uidx").on(
      t.zernioProfileId,
      t.platform,
    ),
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
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    // Pure join row — dies with the membership (cascade, unlike the
    // attribution FKs elsewhere which SET NULL).
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("brand_members_brand_member_uidx").on(t.brandId, t.memberId),
    index("brand_members_org_member_idx").on(t.orgId, t.memberId),
  ],
);

export const brandsRelations = defineRelationsPart(
  { brands, zernioProfiles, socialAccounts, brandMembers, member },
  (r) => ({
    brands: {
      zernioProfiles: r.many.zernioProfiles({
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
