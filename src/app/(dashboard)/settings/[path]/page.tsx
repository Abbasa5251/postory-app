import { viewPaths } from "@better-auth-ui/core";
import { notFound } from "next/navigation";
import { Settings } from "@/components/auth/settings/settings";

// /settings/{account,security,organizations} — "organizations" is contributed
// by the organization plugin (its default settings view path).
const validPaths = [...Object.values(viewPaths.settings), "organizations"];

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params; // Next 16: params is a Promise
  if (!validPaths.includes(path)) notFound();

  return <Settings path={path} />;
}
