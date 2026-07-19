"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PlatformConfig } from "@/lib/platforms/config";

/** The subset of the platform config the picker needs (single source: §4). */
export type ConnectablePlatform = Pick<
  PlatformConfig,
  "id" | "label" | "color"
>;

/**
 * "Connect account" modal (postory-design "Connections"): a header button that
 * opens a picker of the platforms still available to connect. Already-connected
 * platforms are filtered out by the caller. Each choice is a plain-form POST to
 * the connect-init route (ADR-014) — a real POST so a prefetch can't provision;
 * submitting leaves the page for the Zernio OAuth handshake.
 */
export function ConnectAccountDialog({
  brandId,
  platforms,
}: {
  brandId: string;
  platforms: ConnectablePlatform[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="sm">
            <Plus />
            Connect account
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Connect an account</AlertDialogTitle>
          <AlertDialogDescription>
            Choose a platform to connect. You&apos;ll be sent to the platform to
            authorize access, then brought back here.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {platforms.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            Every supported platform is already connected for this brand.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {platforms.map((platform) => (
              <li key={platform.id}>
                <form
                  method="post"
                  action={`/api/brands/${brandId}/accounts/connect?platform=${platform.id}`}
                >
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
                      style={{ background: platform.color }}
                    >
                      {platform.label.slice(0, 1)}
                    </span>
                    <span className="flex-1 text-sm font-medium">
                      {platform.label}
                    </span>
                    <span className="text-sm font-semibold text-primary">
                      Connect
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
