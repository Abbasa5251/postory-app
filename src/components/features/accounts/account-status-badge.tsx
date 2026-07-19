import { cn } from "@/lib/utils";

/**
 * Connection-health badge (B3), styled to the postory-design "Connections"
 * pills. Two states (ADR-009 re-amended): `connected` (green) or `needs_reauth`
 * (amber — the "Reconnect" prompt). Any unknown value degrades to
 * needs-attention rather than pretending health.
 */
export function AccountStatusBadge({ status }: { status: string }) {
  const connected = status === "connected";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        connected
          ? "bg-status-published text-status-published-foreground"
          : "bg-status-pending text-status-pending-foreground",
      )}
    >
      {connected ? "Connected" : "Reconnect needed"}
    </span>
  );
}
