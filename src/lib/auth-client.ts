import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No client-side ac/roles: permission checks go through the server's
// hasPermission endpoint (used by better-auth-ui), keeping
// src/server/auth/permissions.ts out of the client bundle.
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
