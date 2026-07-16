-- Custom migration (hand-written). posts.current_version_id must point at a
-- version OF THIS POST (PRD §5: approvals bind to versions; a cross-post
-- current version would corrupt the approval chain). The composite FK needs
-- PG-15+ column-list ON DELETE SET NULL — nulling only current_version_id,
-- never the PK — which drizzle can't express, so the schema declares no FK
-- for this column and this migration owns the constraint. Targets the
-- post_versions_post_id_id_key unique key from the a5 migration.
ALTER TABLE "posts" ADD CONSTRAINT "posts_current_version_fkey"
  FOREIGN KEY ("id", "current_version_id")
  REFERENCES "post_versions"("post_id", "id")
  ON DELETE SET NULL ("current_version_id");
