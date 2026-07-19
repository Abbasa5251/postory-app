import { PencilRuler } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The mockup's "next on the board" placeholder for screens queued in the build
 * order — the shell, tokens, and patterns they'll use are already in place.
 * Rendered by brand-scoped nav routes whose feature epic hasn't shipped yet
 * (calendar/posts/composer/approvals/analytics/media, billing).
 */
export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
        {icon ?? <PencilRuler className="size-6" />}
      </div>
      <h2 className="font-heading text-lg font-semibold">
        {title} is next on the board
      </h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {description ??
          "This screen is queued in the build order — the shell, tokens, and patterns it will use are already in place."}
      </p>
    </div>
  );
}
