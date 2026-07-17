import { Button } from "@/components/ui/button";
import { PLATFORM_LIST } from "@/lib/platforms/config";

/**
 * Connect controls — one plain HTML form per launch platform, POSTing to the
 * connect-init route (ADR-014). No client JS: a form submit is a real POST, so
 * a link prefetch can never trigger profile provisioning. Rendered only for
 * managers (owner/admin/approver); the account:connect gate is the enforcement.
 */
export function ConnectAccountButtons({ brandId }: { brandId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PLATFORM_LIST.map((platform) => (
        <form
          key={platform.id}
          method="post"
          action={`/api/brands/${brandId}/accounts/connect?platform=${platform.id}`}
        >
          <Button type="submit" variant="outline" size="sm">
            Connect {platform.label}
          </Button>
        </form>
      ))}
    </div>
  );
}
