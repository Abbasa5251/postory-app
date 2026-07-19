import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Reusable empty-state (A7 design system): an optional icon tile, title,
 * description, and action, in a dashed card. The single home for "nothing here
 * yet" surfaces so they stay visually consistent (§4) — replaces the ad-hoc
 * inline empties on the brands and accounts pages.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-accent text-primary">
          {icon}
        </div>
      )}
      <h3 className="font-heading text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
