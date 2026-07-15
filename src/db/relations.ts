import { defineRelations } from "drizzle-orm";
import * as test from "./schemas/test";
import { authRelations } from "./schemas/auth";

// defineRelations and defineRelationsPart both produce plain records keyed by
// table name, so schema-domain parts compose via spread.
export const relations = {
  ...defineRelations(test),
  ...authRelations,
};
