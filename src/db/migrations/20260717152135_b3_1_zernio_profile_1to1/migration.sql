DROP INDEX "zernio_profiles_brand_no_uidx";--> statement-breakpoint
DROP INDEX "social_accounts_profile_platform_uidx";--> statement-breakpoint
ALTER TABLE "zernio_profiles" DROP COLUMN "profile_no";--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_profiles_brand_uidx" ON "zernio_profiles" ("brand_id");--> statement-breakpoint
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_status_check", ADD CONSTRAINT "social_accounts_status_check" CHECK ("status" IN ('connected', 'needs_reauth'));