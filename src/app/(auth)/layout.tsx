import Link from "next/link";

// Public auth shell (postory-design "Auth pages"): the Postory wordmark above a
// centered card. The card itself is the vendored better-auth-ui view, which
// inherits the design tokens.
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-7 p-4">
      <Link
        href="/"
        className="flex items-center gap-2 font-heading text-xl font-bold tracking-tight"
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
          P
        </span>
        Postory
      </Link>
      {children}
    </div>
  );
}
