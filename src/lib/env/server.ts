import { createEnv } from "@t3-oss/env-nextjs";
import * as z from "zod";
 
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32)
  },
  experimental__runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
