import { notFound } from "next/navigation";
import { Organization } from "@/components/auth/organization/organization";

// Organization plugin default view paths: /organization/{settings,people}.
const validPaths = ["settings", "people"];

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params; // Next 16: params is a Promise
  if (!validPaths.includes(path)) notFound();

  return <Organization path={path} />;
}
