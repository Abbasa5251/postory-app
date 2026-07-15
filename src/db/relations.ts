import {defineRelations} from "drizzle-orm";
import * as test from "./schemas/test";

export const relations = defineRelations(test);
