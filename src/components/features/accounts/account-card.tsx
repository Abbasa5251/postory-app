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
 * One connected account (B3). Shows platform, handle, avatar, and health. A
 * `needs_reauth` account gets a Reconnect affordance — a plain form re-running
 * the connect flow for its platform (the callback flips it back to
 * `connected`). Manage controls render only for owner/admin/approver (UX; the
 * route/action gate is enforcement).
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
  const label = getPlatformConfig(account.platform)?.label ?? account.platform;
  const needsReauth = account.status !== "connected";

  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <Avatar>
          {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}
          <AvatarFallback>{label.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col">
          <span className="font-medium">{account.handle}</span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AccountStatusBadge status={account.status} />
          {canManage && needsReauth && (
            <form
              method="post"
              action={`/api/brands/${brandId}/accounts/connect?platform=${account.platform}`}
            >
              <Button type="submit" variant="outline" size="sm">
                Reconnect
              </Button>
            </form>
          )}
          {canManage && (
            <DisconnectAccountButton
              brandId={brandId}
              accountId={account.id}
              handle={account.handle}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
