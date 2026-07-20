import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * A composer section that's part of the design but not yet wired (C1 ships the
 * shell; AI copy = C2/C3, media = C4, scheduling = F1). Rendered visibly but
 * inert so the page matches the postory-design mockup and telegraphs the
 * roadmap, mirroring the `ComingSoon` placeholder convention.
 */
export function DisabledCard({
  title,
  soon,
  children,
  className,
}: {
  title: string;
  /** Short label for the epic this lands in, e.g. "C2". */
  soon: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      aria-disabled
      className={cn("opacity-60", className)}
      title="Coming soon"
    >
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
          {title}
        </CardTitle>
        <Badge variant="secondary">Soon · {soon}</Badge>
      </CardHeader>
      {children && (
        <CardContent className="pointer-events-none text-sm text-muted-foreground select-none">
          {children}
        </CardContent>
      )}
    </Card>
  );
}
