import { Link2 } from "lucide-react";
import { notFound } from "next/navigation";
import { AccountCard } from "@/components/features/accounts/account-card";
import { ConnectAccountDialog } from "@/components/features/accounts/connect-account-dialog";
import { RefreshAccountsButton } from "@/components/features/accounts/refresh-accounts-button";
import { PageHeader } from "@/components/features/shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PLATFORM_LIST } from "@/lib/platforms/config";
import { getAuthCtx } from "@/server/auth/context";
import { listSocialAccounts } from "@/server/dal/accounts";
import { getBrandById } from "@/server/dal/brands";
import { NotFoundError } from "@/server/domain/errors";

const ERROR_MESSAGE: Record<string, string> = {
  platform: "That platform isn't supported.",
  not_found: "That brand could not be found.",
  zernio: "We couldn't reach the publishing service. Please try again.",
  state: "That connection link expired or was invalid. Please try again.",
  unknown: "Something went wrong connecting the account. Please try again.",
};

// Thin route (§5): scoped DAL reads + render. params/searchParams are Promises
// in Next 16.
export default async function BrandAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { brandId } = await params;
  const { error, connected } = await searchParams;
  const ctx = await getAuthCtx();

  let brand;
  try {
    brand = await getBrandById(ctx, brandId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const accounts = await listSocialAccounts(ctx, brandId);
  // UX only (§7): the account:connect/disconnect gates in the route/action are
  // the real enforcement.
  const canManage =
    ctx.role === "owner" || ctx.role === "admin" || ctx.role === "approver";

  // Only offer platforms that aren't already connected for this brand (per the
  // founder's Connect-account UX). Note ADR-009 would technically allow a second
  // same-platform account; this modal deliberately hides connected platforms.
  const connectedPlatforms = new Set(accounts.map((a) => a.platform));
  const availablePlatforms = PLATFORM_LIST.filter(
    (p) => !connectedPlatforms.has(p.id),
  ).map((p) => ({ id: p.id, label: p.label, color: p.color }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Connections"
        description={`Social accounts publishing on behalf of ${brand.name}.`}
        actions={
          canManage ? (
            <>
              <RefreshAccountsButton brandId={brand.id} />
              <ConnectAccountDialog
                brandId={brand.id}
                platforms={availablePlatforms}
              />
            </>
          ) : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {ERROR_MESSAGE[error] ?? ERROR_MESSAGE.unknown}
        </p>
      )}
      {connected && !error && (
        <p
          role="status"
          className="rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground"
        >
          Account connected.
        </p>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Link2 className="size-5" />}
          title="No accounts connected yet"
          description={
            canManage
              ? "Use “Connect account” to link a social account and start publishing for this brand."
              : "An account manager hasn't connected any social accounts for this brand yet."
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountCard
                account={account}
                brandId={brand.id}
                canManage={canManage}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
