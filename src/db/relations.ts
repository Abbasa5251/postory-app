import { analyticsRelations } from "./schemas/analytics";
import { approvalsRelations } from "./schemas/approvals";
import { authRelations } from "./schemas/auth";
import { billingRelations } from "./schemas/billing";
import { brandsRelations } from "./schemas/brands";
import { mediaRelations } from "./schemas/media";
import { orgsRelations } from "./schemas/orgs";
import { postsRelations } from "./schemas/posts";
import { webhooksRelations } from "./schemas/webhooks";

// defineRelations and defineRelationsPart both produce plain records keyed by
// table name, so schema-domain parts compose via spread. Each table's FULL
// relation set lives in exactly one part (its owning file) — a later spread
// with the same key would silently clobber the earlier one.
export const relations = {
  ...authRelations,
  ...orgsRelations,
  ...brandsRelations,
  ...mediaRelations,
  ...postsRelations,
  ...approvalsRelations,
  ...billingRelations,
  ...analyticsRelations,
  ...webhooksRelations,
};
