CREATE TABLE "comment_mentions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text NOT NULL,
	"comment_id" uuid NOT NULL,
	"mentioned_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_comment_member_uidx" ON "comment_mentions" ("comment_id","mentioned_member_id");--> statement-breakpoint
CREATE INDEX "comment_mentions_org_member_idx" ON "comment_mentions" ("org_id","mentioned_member_id");--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_mentioned_member_id_member_id_fkey" FOREIGN KEY ("mentioned_member_id") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_org_comment_fkey" FOREIGN KEY ("org_id","comment_id") REFERENCES "comments"("org_id","id") ON DELETE CASCADE;