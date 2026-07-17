import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountCard } from "@/components/features/accounts/account-card";
import { ConnectAccountButtons } from "@/components/features/accounts/connect-account-buttons";
import { RefreshAccountsButton } from "@/components/features/accounts/refresh-accounts-button";
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

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link
          href={`/brands/${brand.id}/settings`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← {brand.name}
        </Link>
        <h1 className="font-heading text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Connect the social accounts this brand publishes to.
        </p>
      </div>

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

      {canManage && (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-medium">
            Connect an account
          </h2>
          <ConnectAccountButtons brandId={brand.id} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg font-medium">
            Connected accounts
          </h2>
          {/* Always available to managers — Refresh is also how a drifted
              connection (authorized at Zernio but not persisted here, e.g. a
              closed tab) self-heals, which must work even with zero local rows. */}
          {canManage && <RefreshAccountsButton brandId={brand.id} />}
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No accounts connected yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
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
      </section>
    </div>
  );
}
