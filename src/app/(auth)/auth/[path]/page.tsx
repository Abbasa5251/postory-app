import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";
import { Auth } from "@/components/auth/auth";

// /auth/{sign-in,sign-up,sign-out,forgot-password,reset-password,verify-email}
export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params; // Next 16: params is a Promise
  if (!Object.values(viewPaths.auth).includes(path)) notFound();

  return (
    <div className="w-full max-w-sm">
      <Auth path={path} />
    </div>
  );
}
