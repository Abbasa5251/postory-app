import { Check } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/features/shell/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { listSocialAccounts } from "@/server/dal/accounts";
import { listOrgMembers } from "@/server/dal/org";
import { requireBrand } from "../_lib/require-brand";

// The brand's home (postory-design "Dashboard"). Data-driven panels (stats,
// upcoming, top posts, approvals) are Epics F/G/E — shown here as honest empty
// states, not fake data. The day-1 setup checklist is derived from real reads.
export default async function BrandDashboardPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const { ctx, brand } = await requireBrand(brandId);

  const [accounts, members] = await Promise.all([
    listSocialAccounts(ctx, brand.id),
    // Org-scoped read; tolerate roles that can't list members (checklist only).
    listOrgMembers(ctx).catch(() => []),
  ]);

  const steps = [
    { label: "Create your first brand", done: true, href: null },
    {
      label: "Connect a social account",
      done: accounts.length > 0,
      href: `/brands/${brand.id}/accounts`,
    },
    {
      label: "Invite a teammate",
      done: members.length > 1,
      href: "/organization/members",
    },
    {
      // Scheduling ships with Epic F — always actionable, never auto-complete yet.
      label: "Schedule your first post",
      done: false,
      href: `/brands/${brand.id}/composer`,
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`How ${brand.name} is doing across every connected account.`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Upcoming posts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Nothing scheduled yet. Once you compose and schedule posts,
                they&apos;ll appear here.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Recent performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Analytics appear once this brand has published posts.
              </p>
            </CardContent>
          </Card>
        </div>

        {!allDone && (
          <Card>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle className="text-sm font-semibold">
                  Set up {brand.name}
                </CardTitle>
                <span className="text-xs text-muted-foreground">
                  {doneCount} of {steps.length} done
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${(doneCount / steps.length) * 100}%` }}
                />
              </div>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2.5">
                {steps.map((step) => {
                  const content = (
                    <>
                      <span
                        className={cn(
                          "flex size-4.5 shrink-0 items-center justify-center rounded-full",
                          step.done
                            ? "bg-primary text-primary-foreground"
                            : "border border-input",
                        )}
                      >
                        {step.done && <Check className="size-3" />}
                      </span>
                      <span
                        className={cn(
                          "text-sm",
                          step.done && "text-muted-foreground line-through",
                        )}
                      >
                        {step.label}
                      </span>
                    </>
                  );
                  return (
                    <li key={step.label}>
                      {step.href && !step.done ? (
                        <Link
                          href={step.href}
                          className="flex items-center gap-2.5 rounded-md outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
