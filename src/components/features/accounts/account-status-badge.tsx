import { Badge } from "@/components/ui/badge";

/**
 * Connection-health badge (B3). Two states (ADR-009 re-amended): `connected`
 * or `needs_reauth` (the "Reconnect" prompt). Any unknown value degrades to
 * needs-attention rather than pretending health.
 */
export function AccountStatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return <Badge variant="secondary">Connected</Badge>;
  }
  return <Badge variant="destructive">Reconnect needed</Badge>;
}
