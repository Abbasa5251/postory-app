"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { Role } from "@/lib/auth/roles";
import { brandAccent, brandInitial } from "@/lib/brand-accent";

export type BrandSummary = { id: string; name: string };

/**
 * The mockup's sidebar "workspace switcher" — a BRAND switcher (workspace =
 * brand; the agency/org is the subtitle). Selecting a brand navigates to that
 * brand's current sub-route so context follows the switch. This is a custom
 * component (reads brands, routes on select), NOT the vendored
 * OrganizationSwitcher (which switches orgs — that lives in the footer).
 */
export function BrandSwitcher({
  brands,
  activeBrandId,
  orgName,
  currentSection,
  role
}: {
  brands: BrandSummary[];
  activeBrandId: string | null;
  orgName: string;
  /** The brand sub-route (e.g. "dashboard") to preserve when switching. */
  currentSection: string;
  role: Role;
}) {
  const router = useRouter();
  const active =
    brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null;

  const badge = (id: string, name: string, size = 30) => (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg font-heading font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: brandAccent(id),
      }}
    >
      {brandInitial(name)}
    </span>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent"
              />
            }
          >
            {active ? (
              badge(active.id, active.name)
            ) : (
              <span className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-muted font-heading font-bold text-muted-foreground">
                ?
              </span>
            )}
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">
                {active?.name ?? "Select a brand"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {orgName}
              </span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="min-w-60"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Brands
              </DropdownMenuLabel>
              {brands.map((brand) => (
                <DropdownMenuItem
                  key={brand.id}
                  onClick={() =>
                    router.push(`/brands/${brand.id}/${currentSection}`)
                  }
                >
                  {badge(brand.id, brand.name, 22)}
                  <span className="flex-1 truncate">{brand.name}</span>
                  {brand.id === active?.id && <Check className="size-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {(role === "owner" || role === "admin") && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  render={<Link href="/brands" />}
                  className="text-primary"
                  >
                  <Plus className="size-4" />
                  New brand
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
