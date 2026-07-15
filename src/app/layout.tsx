import type { Metadata } from "next";
import { Geist, Geist_Mono, Figtree } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { env } from "@/lib/env/server";
import { cn } from "@/lib/utils";

const geistHeading = Geist({ subsets: ["latin"], variable: "--font-heading" });

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "POSTORY",
  description:
    "AI post generation, approvals, scheduling and analytics for brand agencies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        figtree.variable,
        geistHeading.variable,
      )}
    >
      <body className="flex min-h-full flex-col">
        <Providers
          googleEnabled={Boolean(
            env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
          )}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
