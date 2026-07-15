CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_org_created_idx" ON "audit_log" ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_created_idx" ON "audit_log" ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" ("actor_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE SET NULL;