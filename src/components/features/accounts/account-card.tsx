import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPlatformConfig } from "@/lib/platforms/config";
import { AccountStatusBadge } from "./account-status-badge";
import { DisconnectAccountButton } from "./disconnect-account-button";

export type AccountCardData = {
  id: string;
  platform: string;
  handle: string;
  avatarUrl: string | null;
  status: string;
};

/**
 * One connected account (B3), styled to the postory-design "Connections" grid
 * card: platform-accented avatar + label + health on top, handle below, manage
 * actions at the bottom. A `needs_reauth` account gets a Reconnect affordance —
 * a plain form re-running the connect flow for its platform (the callback flips
 * it back to `connected`). Manage controls render only for owner/admin/approver
 * (UX; the route/action gate is enforcement).
 */
export function AccountCard({
  account,
  brandId,
  canManage,
}: {
  account: AccountCardData;
  brandId: string;
  canManage: boolean;
}) {
  const config = getPlatformConfig(account.platform);
  const label = config?.label ?? account.platform;
  const needsReauth = account.status !== "connected";

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-7 rounded-lg">
            {account.avatarUrl && (
              <AvatarImage src={account.avatarUrl} alt="" />
            )}
            <AvatarFallback
              className="rounded-lg text-xs font-semibold text-white"
              style={{ background: config?.color ?? "var(--muted-foreground)" }}
            >
              {label.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="flex-1 truncate text-sm font-semibold">{label}</span>
          <AccountStatusBadge status={account.status} />
        </div>

        <div className="truncate text-sm font-medium">{account.handle}</div>

        {canManage && (
          <div className="flex items-center gap-2">
            {needsReauth && (
              <form
                method="post"
                action={`/api/brands/${brandId}/accounts/connect?platform=${account.platform}`}
              >
                <Button type="submit" variant="outline" size="sm">
                  Reconnect
                </Button>
              </form>
            )}
            <DisconnectAccountButton
              brandId={brandId}
              accountId={account.id}
              handle={account.handle}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
