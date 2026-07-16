CREATE TABLE "analytics_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"post_platform_id" uuid NOT NULL,
	"capture_window" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_snapshots_capture_window_check" CHECK ("capture_window" IN ('24h', '72h', '7d', '30d'))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"post_id" uuid NOT NULL,
	"post_version_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"decided_by_member_id" text,
	"decided_by_token_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_stage_check" CHECK ("stage" IN ('internal', 'client')),
	CONSTRAINT "approvals_decision_check" CHECK ("decision" IN ('approved', 'changes_requested')),
	CONSTRAINT "approvals_decided_by_check" CHECK (num_nonnulls("decided_by_member_id", "decided_by_token_id") <= 1),
	CONSTRAINT "approvals_decider_stage_check" CHECK (("stage" <> 'internal' OR "decided_by_token_id" IS NULL) AND ("stage" <> 'client' OR "decided_by_member_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"post_id" uuid NOT NULL,
	"anchor" jsonb,
	"body" text NOT NULL,
	"author_member_id" text,
	"author_token_id" uuid,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_author_check" CHECK (num_nonnulls("author_member_id", "author_token_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"capability" text NOT NULL,
	"scope" jsonb NOT NULL,
	"label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_tokens_capability_check" CHECK ("capability" IN ('approve', 'report'))
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_reason_check" CHECK ("reason" IN ('trial_grant', 'plan_grant', 'pack', 'debit', 'refund', 'expiry'))
);
--> statement-breakpoint
CREATE TABLE "credit_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"action" text NOT NULL,
	"model_id" text NOT NULL,
	"credits" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_rates_action_check" CHECK ("action" IN ('copy', 'image_standard', 'image_premium', 'video_standard', 'video_premium'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"entitlements" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_tier_check" CHECK ("tier" IN ('starter', 'studio', 'agency', 'enterprise'))
);
--> statement-breakpoint
CREATE TABLE "brand_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"logo_url" text,
	"colors" jsonb,
	"voice_profile" jsonb,
	"requires_client_approval" boolean DEFAULT false NOT NULL,
	"client_contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_org_id_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"zernio_profile_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"zernio_account_id" text NOT NULL,
	"handle" text NOT NULL,
	"avatar_url" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "social_accounts_brand_id_id_key" UNIQUE("brand_id","id"),
	CONSTRAINT "social_accounts_platform_check" CHECK ("platform" IN ('instagram', 'facebook', 'tiktok', 'linkedin', 'threads', 'youtube')),
	CONSTRAINT "social_accounts_status_check" CHECK ("status" IN ('connected', 'needs_reauth', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "zernio_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"zernio_profile_id" text NOT NULL,
	"profile_no" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zernio_profiles_brand_id_id_key" UNIQUE("brand_id","id")
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt" text,
	"params" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credits_settled" integer,
	"provider_generation_id" text,
	"error" text,
	"created_by" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_type_check" CHECK ("type" IN ('copy', 'image', 'video')),
	CONSTRAINT "generation_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"duration_seconds" integer,
	"source_model" text,
	"generation_job_id" uuid,
	"moderation_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_kind_check" CHECK ("kind" IN ('image', 'video')),
	CONSTRAINT "media_assets_source_check" CHECK ("source" IN ('upload', 'generated')),
	CONSTRAINT "media_assets_moderation_status_check" CHECK ("moderation_status" IN ('pending', 'passed', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"trial_state" text DEFAULT 'active' NOT NULL,
	"plan_snapshot" jsonb,
	"allow_self_approval" boolean DEFAULT false NOT NULL,
	"defaults" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_trial_state_check" CHECK ("trial_state" IN ('active', 'read_only', 'disconnected', 'subscribed'))
);
--> statement-breakpoint
CREATE TABLE "post_platforms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"overrides" jsonb,
	"publish_status" text DEFAULT 'pending' NOT NULL,
	"publish_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_platforms_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "post_platforms_publish_status_check" CHECK ("publish_status" IN ('pending', 'publishing', 'published', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "post_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"post_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content" jsonb NOT NULL,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_versions_post_id_id_key" UNIQUE("post_id","id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"brand_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"current_version_id" uuid,
	"created_by" text,
	"internal_approved_by" text,
	"scheduled_for" timestamp with time zone,
	"scheduled_tz" text,
	"zernio_post_id" text,
	"publish_result" jsonb,
	"labels" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_org_id_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "posts_brand_id_id_key" UNIQUE("brand_id","id"),
	CONSTRAINT "posts_status_check" CHECK ("status" IN ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'CLIENT_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_check" CHECK ("provider" IN ('stripe', 'zernio'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_snapshots_platform_window_uidx" ON "analytics_snapshots" ("post_platform_id","capture_window");--> statement-breakpoint
CREATE INDEX "analytics_snapshots_org_captured_idx" ON "analytics_snapshots" ("org_id","captured_at");--> statement-breakpoint
CREATE INDEX "approvals_org_post_idx" ON "approvals" ("org_id","post_id");--> statement-breakpoint
CREATE INDEX "approvals_post_stage_round_idx" ON "approvals" ("post_id","stage","round");--> statement-breakpoint
CREATE INDEX "comments_org_post_idx" ON "comments" ("org_id","post_id");--> statement-breakpoint
CREATE INDEX "comments_post_created_idx" ON "comments" ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_hash_uidx" ON "portal_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX "portal_tokens_org_brand_idx" ON "portal_tokens" ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_org_expires_idx" ON "credit_ledger" ("org_id","expires_at") WHERE "expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_rates_model_uidx" ON "credit_rates" ("model_id");--> statement-breakpoint
CREATE INDEX "credit_rates_action_active_idx" ON "credit_rates" ("action") WHERE "is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_uidx" ON "subscriptions" ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_customer_uidx" ON "subscriptions" ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_uidx" ON "subscriptions" ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_members_brand_member_uidx" ON "brand_members" ("brand_id","member_id");--> statement-breakpoint
CREATE INDEX "brand_members_org_member_idx" ON "brand_members" ("org_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_slug_uidx" ON "brands" ("org_id","slug");--> statement-breakpoint
CREATE INDEX "brands_org_created_idx" ON "brands" ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_profile_platform_uidx" ON "social_accounts" ("zernio_profile_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_zernio_account_uidx" ON "social_accounts" ("zernio_account_id");--> statement-breakpoint
CREATE INDEX "social_accounts_org_brand_idx" ON "social_accounts" ("org_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_profiles_brand_no_uidx" ON "zernio_profiles" ("brand_id","profile_no");--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_profiles_external_uidx" ON "zernio_profiles" ("zernio_profile_id");--> statement-breakpoint
CREATE INDEX "zernio_profiles_org_brand_idx" ON "zernio_profiles" ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_org_brand_created_idx" ON "generation_jobs" ("org_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_org_status_idx" ON "generation_jobs" ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_r2_key_uidx" ON "media_assets" ("r2_key");--> statement-breakpoint
CREATE INDEX "media_assets_org_brand_created_idx" ON "media_assets" ("org_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_settings_org_uidx" ON "org_settings" ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_platforms_post_account_uidx" ON "post_platforms" ("post_id","social_account_id");--> statement-breakpoint
CREATE INDEX "post_platforms_org_status_idx" ON "post_platforms" ("org_id","publish_status");--> statement-breakpoint
CREATE UNIQUE INDEX "post_versions_post_no_uidx" ON "post_versions" ("post_id","version_no");--> statement-breakpoint
CREATE INDEX "post_versions_org_created_idx" ON "post_versions" ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_zernio_post_uidx" ON "posts" ("zernio_post_id");--> statement-breakpoint
CREATE INDEX "posts_org_brand_created_idx" ON "posts" ("org_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_org_status_idx" ON "posts" ("org_id","status");--> statement-breakpoint
CREATE INDEX "posts_org_scheduled_idx" ON "posts" ("org_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_uidx" ON "webhook_events" ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" ("created_at") WHERE "processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "webhook_events_org_idx" ON "webhook_events" ("org_id");--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_org_platform_fkey" FOREIGN KEY ("org_id","post_platform_id") REFERENCES "post_platforms"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_member_id_member_id_fkey" FOREIGN KEY ("decided_by_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_token_id_portal_tokens_id_fkey" FOREIGN KEY ("decided_by_token_id") REFERENCES "portal_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_post_fkey" FOREIGN KEY ("org_id","post_id") REFERENCES "posts"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_post_version_fkey" FOREIGN KEY ("post_id","post_version_id") REFERENCES "post_versions"("post_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_member_id_member_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_token_id_portal_tokens_id_fkey" FOREIGN KEY ("author_token_id") REFERENCES "portal_tokens"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_post_fkey" FOREIGN KEY ("org_id","post_id") REFERENCES "posts"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_created_by_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_member_id_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_member_id_fkey" FOREIGN KEY ("connected_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_profile_fkey" FOREIGN KEY ("brand_id","zernio_profile_id") REFERENCES "zernio_profiles"("brand_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "zernio_profiles" ADD CONSTRAINT "zernio_profiles_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "zernio_profiles" ADD CONSTRAINT "zernio_profiles_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_created_by_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_generation_job_id_generation_jobs_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_platforms" ADD CONSTRAINT "post_platforms_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_platforms" ADD CONSTRAINT "post_platforms_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_platforms" ADD CONSTRAINT "post_platforms_brand_post_fkey" FOREIGN KEY ("brand_id","post_id") REFERENCES "posts"("brand_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_platforms" ADD CONSTRAINT "post_platforms_brand_account_fkey" FOREIGN KEY ("brand_id","social_account_id") REFERENCES "social_accounts"("brand_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_created_by_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "post_versions" ADD CONSTRAINT "post_versions_org_post_fkey" FOREIGN KEY ("org_id","post_id") REFERENCES "posts"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_current_version_id_post_versions_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "post_versions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_internal_approved_by_member_id_fkey" FOREIGN KEY ("internal_approved_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_org_brand_fkey" FOREIGN KEY ("org_id","brand_id") REFERENCES "brands"("org_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE SET NULL;