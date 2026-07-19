"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useActionForm } from "@/hooks/use-action-form";
import { parseHashtags } from "@/lib/text";
import type { VoiceProfile } from "@/lib/validation/brands";
import { updateBrandVoice } from "@/server/actions/brands";

/**
 * Brand voice profile editor (B2). Tone + banned words + brand hashtags +
 * sample posts — all optional, feeds AI generation (Epics C/D). Banned words
 * and hashtags are pasted as lists (parsed via the shared `@/lib/text`
 * helpers); sample posts are repeatable multi-line rows. The server schema
 * re-normalizes and validates everything.
 */
export function BrandVoiceForm({
  brand,
}: {
  brand: { id: string; voiceProfile: VoiceProfile | null };
}) {
  const router = useRouter();
  const vp = brand.voiceProfile;
  const [tone, setTone] = useState(vp?.tone ?? "");
  const [bannedWords, setBannedWords] = useState<string[]>(
    vp?.bannedWords ?? [],
  );
  const [bannedDraft, setBannedDraft] = useState("");
  const [hashtags, setHashtags] = useState((vp?.hashtags ?? []).join("\n"));

  function addBannedWord() {
    const word = bannedDraft.trim();
    if (word && !bannedWords.includes(word)) {
      setBannedWords((prev) => [...prev, word]);
    }
    setBannedDraft("");
  }
  const [samplePosts, setSamplePosts] = useState<string[]>(
    vp?.samplePosts ?? [],
  );

  const { pending, message, fieldErrors, run } = useActionForm(
    updateBrandVoice,
    {
      onSuccess: () => {
        toast.success("Voice profile saved");
        router.refresh();
      },
    },
  );

  // Validation errors nest under the whole voiceProfile object (flattened).
  const voiceError = fieldErrors?.voiceProfile?.[0] ?? message;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Flush any half-typed banned word so it isn't lost on submit.
    const draft = bannedDraft.trim();
    const banned =
      draft && !bannedWords.includes(draft)
        ? [...bannedWords, draft]
        : bannedWords;
    void run({
      id: brand.id,
      voiceProfile: {
        tone,
        bannedWords: banned,
        hashtags: parseHashtags(hashtags),
        samplePosts: samplePosts.map((p) => p.trim()).filter(Boolean),
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field>
        <Label htmlFor="voice-tone">Tone</Label>
        <Textarea
          id="voice-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="Warm and a little cheeky; never corporate."
          disabled={pending}
          rows={3}
        />
        <FieldDescription>
          Describe how the brand should sound. Feeds AI copy.
        </FieldDescription>
      </Field>

      <Field>
        <Label htmlFor="voice-banned">Banned words &amp; phrases</Label>
        <div className="flex flex-wrap items-center gap-2">
          {bannedWords.map((word) => (
            <span
              key={word}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted py-1 pr-1.5 pl-3 text-sm"
            >
              {word}
              <button
                type="button"
                aria-label={`Remove ${word}`}
                disabled={pending}
                onClick={() =>
                  setBannedWords((prev) => prev.filter((w) => w !== word))
                }
                className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            id="voice-banned"
            value={bannedDraft}
            onChange={(e) => setBannedDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addBannedWord();
              }
            }}
            onBlur={addBannedWord}
            placeholder="Add a word…"
            disabled={pending}
            className="min-w-28 flex-1 rounded-full border border-dashed border-input bg-transparent px-3 py-1 text-sm outline-none focus:border-ring"
          />
        </div>
        <FieldDescription>
          Words and phrases the AI must never use. Press Enter to add.
        </FieldDescription>
      </Field>

      <Field>
        <Label htmlFor="voice-hashtags">Brand hashtags</Label>
        <Textarea
          id="voice-hashtags"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="#OnBrand #Launch (spaces, commas, or new lines)"
          disabled={pending}
          rows={3}
        />
        <FieldDescription>
          The leading # is optional; letters, numbers, and underscores only.
        </FieldDescription>
      </Field>

      <Field>
        <Label>Sample posts</Label>
        <FieldDescription>
          Example posts that capture the voice — the AI imitates these.
        </FieldDescription>
        <div className="flex flex-col gap-2">
          {samplePosts.map((post, index) => (
            <div key={index} className="flex items-start gap-2">
              <Textarea
                aria-label={`Sample post ${index + 1}`}
                value={post}
                onChange={(e) =>
                  setSamplePosts((posts) =>
                    posts.map((p, i) => (i === index ? e.target.value : p)),
                  )
                }
                placeholder="Paste an on-brand post…"
                disabled={pending}
                rows={3}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove sample post"
                disabled={pending}
                onClick={() =>
                  setSamplePosts((posts) => posts.filter((_, i) => i !== index))
                }
              >
                <X />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setSamplePosts((posts) => [...posts, ""])}
            >
              <Plus />
              Add sample post
            </Button>
          </div>
        </div>
      </Field>

      {voiceError && <p className="text-sm text-destructive">{voiceError}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Save voice profile
        </Button>
      </div>
    </form>
  );
}
