"use client";

import { useRouter } from "next/navigation";
import { type SyntheticEvent, useState } from "react";
import { UserInvitations } from "@/components/auth/organization/user-invitations";
import {
  SlugField,
  sanitizeSlug,
} from "@/components/auth/organization/slug-field";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function OnboardingCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(undefined);
    setIsCreating(true);
    try {
      // organization.create auto-sets the new org as the session's active org;
      // a server-side navigation re-runs the (dashboard) layout gate.
      const { error: createError } = await authClient.organization.create({
        name,
        slug,
      });
      if (createError) {
        setError(createError.message);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-heading text-xl">
          Create your organization
        </CardTitle>
        <CardDescription>
          This is your agency&apos;s home in Postory — your team, billing, and
          every client brand live under it. Or accept a pending invitation
          below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="organization-name">Organization name</Label>
            <Input
              id="organization-name"
              value={name}
              placeholder="Acme Agency"
              required
              onChange={(e) => {
                setName(e.target.value);
                if (!slugEdited) setSlug(sanitizeSlug(e.target.value));
              }}
              disabled={isCreating}
            />
          </div>
          <SlugField
            value={slug}
            onChange={(value) => {
              setSlug(value);
              setSlugEdited(true);
            }}
            disabled={isCreating}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={isCreating || !name || !slug}>
            {isCreating && <Spinner />}
            Create organization
          </Button>
        </form>

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Pending invitations</p>
          <UserInvitations />
          <Button
            variant="outline"
            onClick={() => router.replace("/dashboard")}
          >
            Continue to dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
