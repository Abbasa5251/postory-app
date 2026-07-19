import { BarChart3, CircleCheck, LayoutGrid, Sparkles } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PLATFORM_CONFIG } from "@/lib/platforms/config";
import { cn } from "@/lib/utils";
import { auth } from "@/server/auth/auth";

// Public marketing landing (postory-design "Landing page"). Static content;
// CTAs route to the real auth flows. Uses the shared design tokens.

const HERO_PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
] as const;

const STATUS = {
  pending: "bg-status-pending text-status-pending-foreground",
  scheduled: "bg-status-scheduled text-status-scheduled-foreground",
  published: "bg-status-published text-status-published-foreground",
} as const;

type WeekEntry = {
  label: string;
  platform: keyof typeof PLATFORM_CONFIG;
  status: keyof typeof STATUS;
};

const WEEK: { name: string; posts: WeekEntry[] }[] = [
  {
    name: "Mon",
    posts: [
      { label: "Espresso dial-in", platform: "tiktok", status: "published" },
    ],
  },
  {
    name: "Tue",
    posts: [{ label: "Meet Elena", platform: "instagram", status: "pending" }],
  },
  {
    name: "Wed",
    posts: [
      { label: "Cold brew flight", platform: "instagram", status: "scheduled" },
      { label: "Cold brew flight", platform: "facebook", status: "scheduled" },
    ],
  },
  { name: "Thu", posts: [] },
  {
    name: "Fri",
    posts: [
      { label: "Summer lineup", platform: "linkedin", status: "scheduled" },
    ],
  },
  {
    name: "Sat",
    posts: [
      { label: "Cupping recap", platform: "instagram", status: "scheduled" },
      { label: "Pour-over how-to", platform: "youtube", status: "scheduled" },
    ],
  },
  { name: "Sun", posts: [] },
];

const FEATURES = [
  {
    icon: LayoutGrid,
    title: "One workspace per brand",
    body: "Switch between clients in one click. Separate calendars, accounts, and voice profiles — nothing leaks between brands.",
  },
  {
    icon: Sparkles,
    title: "AI that learns the voice",
    body: "Feed it tone, banned words, and real sample posts. Get captions the client would actually sign off on — per platform, on length.",
  },
  {
    icon: CircleCheck,
    title: "Approvals built in",
    body: "Creators draft, approvers sign off. Nothing publishes without the right eyes on it, and every decision is on the record.",
  },
  {
    icon: BarChart3,
    title: "Numbers clients believe",
    body: "Follower growth, reach, and engagement per platform — ready to drop into the monthly report, not screenshot from five dashboards.",
  },
];

const TIERS = [
  {
    name: "STARTER",
    price: "$59",
    blurb: "3 brands · 5 accounts · 500 AI credits",
    featured: false,
  },
  {
    name: "STUDIO",
    price: "$149",
    blurb: "10 brands · 12 accounts · 2,000 AI credits",
    featured: true,
  },
  {
    name: "AGENCY",
    price: "$349",
    blurb: "30 brands · 30 accounts · 6,000 AI credits",
    featured: false,
  },
];

const LOGOS = [
  "North&Co",
  "Studio Pilcrow",
  "Hatch Social",
  "Meridian PR",
  "Loud&Clear",
];

function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 font-heading font-bold tracking-tight",
        className,
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
        P
      </span>
      Postory
    </span>
  );
}

export default async function LandingPage() {
  // Personalize CTAs for authenticated visitors (marketing page → dashboard).
  const session = await auth.api.getSession({ headers: await headers() });
  const signedIn = Boolean(session);

  return (
    <div className="min-h-svh">
      <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
        {/* Nav */}
        <header className="flex items-center gap-6 py-5">
          <Wordmark className="text-lg" />
          <nav className="hidden flex-1 items-center gap-6 text-sm font-medium text-muted-foreground sm:flex">
            <a href="#features" className="hover:text-foreground">
              Product
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <a href="#features" className="hover:text-foreground">
              For agencies
            </a>
          </nav>
          {signedIn ? (
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ size: "sm" }), "ml-auto sm:ml-0")}
            >
              Go to dashboard
            </Link>
          ) : (
            <div className="ml-auto flex items-center gap-4 sm:ml-0">
              <Link href="/auth/sign-in" className="text-sm font-semibold">
                Log in
              </Link>
              <Link
                href="/auth/sign-up"
                className={buttonVariants({ size: "sm" })}
              >
                Start free
              </Link>
            </div>
          )}
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-3xl pt-16 pb-12 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs font-semibold text-muted-foreground">
            <span className="flex">
              {HERO_PLATFORMS.map((platform, i) => (
                <span
                  key={platform}
                  className={cn(
                    "size-3 rounded-full ring-2 ring-card",
                    i > 0 && "-ml-1",
                  )}
                  style={{ background: PLATFORM_CONFIG[platform].color }}
                />
              ))}
            </span>
            Six platforms, one queue
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Every client. Every platform. One calendar.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
            Postory is where agencies plan, write, approve, and publish social
            content for all their client brands — with AI that actually sounds
            like the client.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href={signedIn ? "/dashboard" : "/auth/sign-up"}
              className={buttonVariants({ size: "lg" })}
            >
              {signedIn ? "Go to dashboard" : "Start free — no card needed"}
            </Link>
            <a
              href="mailto:support@postory.app"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Book a demo
            </a>
          </div>
        </section>

        {/* Calendar preview */}
        <section className="mb-16 rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="text-sm font-semibold">
              This week · Driftwood Coffee
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              the calendar your whole roster fits in
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
            {WEEK.map((day) => (
              <div
                key={day.name}
                className="min-h-28 rounded-xl border bg-background p-2.5"
              >
                <div className="mb-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                  {day.name}
                </div>
                <div className="flex flex-col gap-1.5">
                  {day.posts.map((post, i) => (
                    <span
                      key={`${day.name}-${i}`}
                      className={cn(
                        "truncate rounded-[5px] border-l-[3px] px-1.5 py-1 text-[11px] font-medium",
                        STATUS[post.status],
                      )}
                      style={{
                        borderLeftColor: PLATFORM_CONFIG[post.platform].color,
                      }}
                    >
                      {post.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="pb-14 text-center">
          <div className="mb-5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
            Trusted by 400+ agencies
          </div>
          <div className="flex flex-wrap items-center justify-center gap-9">
            {LOGOS.map((logo) => (
              <span
                key={logo}
                className="font-heading text-base font-semibold text-muted-foreground/50"
              >
                {logo}
              </span>
            ))}
          </div>
        </section>

        {/* Features */}
        <section
          id="features"
          className="grid gap-3.5 pb-16 sm:grid-cols-2 lg:grid-cols-4"
        >
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-2xl border bg-card p-6">
              <div className="mb-4 flex size-9 items-center justify-center rounded-xl bg-accent text-primary">
                <feature.icon className="size-4.5" />
              </div>
              <h3 className="mb-1.5 font-heading text-base font-semibold">
                {feature.title}
              </h3>
              <p className="text-sm text-pretty text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </section>

        {/* Pricing CTA */}
        <section
          id="pricing"
          className="mb-16 rounded-3xl bg-foreground px-6 py-12 text-center sm:px-10 sm:py-14"
        >
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-background sm:text-3xl">
            Plans that scale with your roster
          </h2>
          <p className="mx-auto mt-2.5 max-w-md text-sm text-background/70">
            Starter for small teams, Studio for growing rosters, Agency for the
            big leagues.
          </p>
          <div className="mx-auto mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={cn(
                  "rounded-2xl border p-5 text-left",
                  tier.featured
                    ? "border-primary bg-primary/10"
                    : "border-background/15 bg-background/5",
                )}
              >
                <div className="text-xs font-bold text-background/70">
                  {tier.name}
                </div>
                <div className="mt-1.5 font-heading text-2xl font-semibold text-background">
                  {tier.price}
                  <span className="text-sm font-medium text-background/60">
                    /mo
                  </span>
                </div>
                <div className="mt-1 text-xs text-background/70">
                  {tier.blurb}
                </div>
              </div>
            ))}
          </div>
          <Link
            href={signedIn ? "/dashboard" : "/auth/sign-up"}
            className={cn(buttonVariants({ size: "lg" }), "mt-7")}
          >
            {signedIn ? "Go to dashboard" : "Start your free trial"}
          </Link>
        </section>

        {/* Footer */}
        <footer className="flex flex-wrap items-start justify-between gap-6 border-t py-8">
          <Wordmark className="text-base" />
          <div className="flex flex-wrap gap-5 text-xs text-muted-foreground">
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <a href="#" className="hover:text-foreground">
              Terms of Service
            </a>
            <a href="#" className="hover:text-foreground">
              Privacy Policy
            </a>
            <a
              href="mailto:support@postory.app"
              className="hover:text-foreground"
            >
              support@postory.app
            </a>
          </div>
          <span className="text-xs text-muted-foreground/70">
            © 2026 Postory Labs, Inc.
          </span>
        </footer>
      </div>
    </div>
  );
}
