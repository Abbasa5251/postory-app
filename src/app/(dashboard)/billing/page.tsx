import { CreditCard } from "lucide-react";
import { ComingSoon } from "@/components/features/shell/coming-soon";

// Org-level billing (Epic H owns the real screen — plans, usage, invoices).
export default function BillingPage() {
  return (
    <ComingSoon title="Billing" icon={<CreditCard className="size-6" />} />
  );
}
