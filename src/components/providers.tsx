"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthProvider } from "@/components/auth/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { authClient } from "@/lib/auth-client";
import { organizationPlugin } from "@/lib/auth/organization-plugin";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getQueryClient } from "@/lib/query-client";

// `roles` REPLACES better-auth-ui's default role list, so the built-in
// "member" role never appears in invite/role dropdowns (permissions.ts maps
// it to zero permissions as a defense-in-depth backstop).
const plugins = [organizationPlugin({ roles: ROLE_LABELS })];

export function Providers({
  children,
  googleEnabled,
}: {
  children: React.ReactNode;
  googleEnabled: boolean;
}) {
  const router = useRouter();

  return (
    <AuthProvider
      authClient={authClient}
      queryClient={getQueryClient()}
      redirectTo="/dashboard"
      socialProviders={googleEnabled ? ["google"] : []}
      navigate={({ to, replace }) =>
        replace ? router.replace(to) : router.push(to)
      }
      Link={Link}
      plugins={plugins}
    >
      {children}
      <Toaster />
    </AuthProvider>
  );
}
