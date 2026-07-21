import type { ReactElement } from "react";
import type { Platform } from "@/lib/platforms/config";
import { cn } from "@/lib/utils";

/**
 * Monochrome brand marks for the 6 launch platforms, used by the C5 feed-accurate
 * preview cards to give each preview its native identity. lucide-react (v1) no
 * longer ships social brand glyphs (removed for trademark reasons — verified:
 * `Instagram`/`Facebook`/`Linkedin`/`Youtube` are all `undefined`), and we add no
 * icon dependency (AGENTS.md §9), so these are inline SVGs.
 *
 * Each glyph draws with `currentColor` so callers tint it via `text-*` (the
 * preview uses `PLATFORM_CONFIG[platform].color`, the single source for platform
 * accents — §4). Facebook / LinkedIn / YouTube / TikTok use the widely-published
 * brand path data; Instagram (camera) and Threads (@-swirl) are clean simplified
 * marks. Swap in exact trademark SVGs here without touching any caller.
 */

type LogoProps = { className?: string };

function svgProps(className: string | undefined) {
  return {
    viewBox: "0 0 24 24",
    className: cn("size-full", className),
    role: "img" as const,
    "aria-hidden": true,
    focusable: false as const,
  };
}

const LOGOS: Record<Platform, (props: LogoProps) => ReactElement> = {
  instagram: ({ className }) => (
    <svg
      {...svgProps(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  facebook: ({ className }) => (
    <svg {...svgProps(className)} fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  ),
  tiktok: ({ className }) => (
    <svg {...svgProps(className)} fill="currentColor">
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  ),
  linkedin: ({ className }) => (
    <svg {...svgProps(className)} fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  ),
  threads: ({ className }) => (
    <svg
      {...svgProps(className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16.6 8.2C15.8 5.8 14 4.6 11.7 4.6 8 4.6 5.7 7.6 5.7 12s2.3 7.4 6 7.4c2.5 0 4.1-1 4.8-2.7.5-1.2.4-2.6-.5-3.4-.8-.8-1.9-1.1-3.1-1.1-2.1 0-3.4 1-3.4 2.5 0 1.3 1.1 2.1 2.5 2.1 2 0 3.1-1.5 3.1-4.4" />
    </svg>
  ),
  youtube: ({ className }) => (
    <svg {...svgProps(className)} fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  ),
};

/** The platform's brand mark, tinted via `currentColor`. */
export function PlatformLogo({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  return LOGOS[platform]({ className });
}
