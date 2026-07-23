"use client";

import {
  BarChart3,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  ImageIcon,
  LayoutDashboard,
  Link2,
  type LucideIcon,
  PenSquare,
  Settings2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher } from "@/components/auth/organization/organization-switcher";
import { UserButton } from "@/components/auth/user/user-button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { Role } from "@/lib/auth/roles";
import { type BrandSummary, BrandSwitcher } from "./brand-switcher";

/** Brand-scoped nav (mockup order). `section` is the sub-path under the brand. */
const BRAND_NAV: { section: string; label: string; icon: LucideIcon }[] = [
  { section: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { section: "calendar", label: "Calendar", icon: Calendar },
  { section: "posts", label: "Posts", icon: FileText },
  { section: "composer", label: "Composer", icon: PenSquare },
  { section: "analytics", label: "Analytics", icon: BarChart3 },
  { section: "accounts", label: "Connections", icon: Link2 },
  { section: "media", label: "Media library", icon: ImageIcon },
  { section: "settings", label: "Brand settings", icon: Settings2 },
];

/** Org-level nav (agency-wide). */
const ORG_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/organization/members", label: "Team", icon: Users },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

/** The active brand and current sub-section, parsed from the URL. */
function useBrandContext(brands: BrandSummary[]) {
  const pathname = usePathname();
  const match = /^\/brands\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  const urlBrandId = match?.[1] ?? null;
  const section = match?.[2] ?? "dashboard";
  const activeBrandId =
    (urlBrandId && brands.some((b) => b.id === urlBrandId)
      ? urlBrandId
      : null) ??
    brands[0]?.id ??
    null;
  return { pathname, activeBrandId, section };
}

export function AppSidebar({
  brands,
  orgName,
  role,
  approvalsCount = 0,
}: {
  brands: BrandSummary[];
  orgName: string;
  role: Role;
  /** Pending review queue count (E2 badge); 0 hides the badge. */
  approvalsCount?: number;
}) {
  const { pathname, activeBrandId, section } = useBrandContext(brands);

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex h-8 items-center px-2">
          <span className="font-heading text-lg font-semibold">Postory</span>
        </div>
        {brands.length > 0 && (
          <BrandSwitcher
            brands={brands}
            activeBrandId={activeBrandId}
            orgName={orgName}
            currentSection={section}
            role={role}
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        {activeBrandId && (
          <SidebarGroup>
            <SidebarMenu>
              {BRAND_NAV.map((item) => {
                const href = `/brands/${activeBrandId}/${item.section}`;
                const isActive = pathname === href;
                return (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.label}
                      render={<Link href={href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {(role === "owner" || role === "admin" || role === "approver") && (
          <>
            <SidebarSeparator />

            {/* Cross-brand reviewer surface (E2) — not brand-scoped, so it lives
                outside BRAND_NAV; limited to the post:approve roles. */}
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/approvals")}
                    tooltip="Approvals"
                    render={<Link href="/approvals" />}
                  >
                    <CheckCircle2 />
                    <span>Approvals</span>
                  </SidebarMenuButton>
                  {approvalsCount > 0 && (
                    // Amber "pending" pill to match the postory-design nav badge
                    // (same status-pending tokens as the review-queue pills, §4).
                    <SidebarMenuBadge className="rounded-full bg-status-pending font-bold text-status-pending-foreground">
                      {approvalsCount}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Agency</SidebarGroupLabel>
              <SidebarMenu>
                {ORG_NAV.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(item.href)}
                      tooltip={item.label}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        {/* Agency switch for multi-org members (the top switcher is brand-level). */}
        <OrganizationSwitcher hidePersonal className="w-full justify-between" />
        <UserButton className="w-full" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
