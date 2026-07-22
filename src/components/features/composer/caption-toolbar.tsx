"use client";

import { useState } from "react";
import { AtSign, Link2, Smile } from "lucide-react";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  buildUtmUrl,
  detectHashtags,
  detectMentions,
} from "@/lib/caption-helpers";
import { utmFormSchema } from "@/lib/validation/posts";

/**
 * Caption toolbar (C6). Emoji / UTM-link / mention helpers plus a live
 * mention+hashtag count for the active caption. Purely presentational: every
 * tool feeds the caption through `onInsert`, which the composer wires to its
 * cursor-aware insertion + `setCaption` seam. No persistence of its own — the
 * inserted text is plain caption content saved by the existing `saveDraft`.
 *
 * Full LinkedIn mention resolution (Zernio's URN endpoint) is deferred beyond
 * C6 (P2) — the mention button inserts a plain-text `@` handle marker, which
 * is how IG/FB/TikTok/Threads/YouTube mentions publish anyway.
 */
type CaptionToolbarProps = {
  caption: string;
  onInsert: (text: string) => void;
};

export function CaptionToolbar({ caption, onInsert }: CaptionToolbarProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const mentions = detectMentions(caption);
  const hashtags = detectHashtags(caption);
  const hasDetections = mentions.length > 0 || hashtags.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Insert emoji"
            >
              <Smile />
            </Button>
          }
        />
        <PopoverContent align="start" className="w-fit p-0">
          <EmojiPicker
            className="h-64"
            onEmojiSelect={(selected) => {
              onInsert(selected.emoji);
              setEmojiOpen(false);
            }}
          >
            <EmojiPickerSearch />
            <EmojiPickerContent />
            <EmojiPickerFooter />
          </EmojiPicker>
        </PopoverContent>
      </Popover>

      <UtmBuilderPopover onInsert={onInsert} />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Insert mention"
        onClick={() => onInsert("@")}
      >
        <AtSign />
      </Button>

      {hasDetections ? (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {mentions.length > 0
            ? `${mentions.length} mention${mentions.length === 1 ? "" : "s"}`
            : null}
          {mentions.length > 0 && hashtags.length > 0 ? " · " : null}
          {hashtags.length > 0
            ? `${hashtags.length} hashtag${hashtags.length === 1 ? "" : "s"}`
            : null}
        </span>
      ) : null}
    </div>
  );
}

type UtmFieldKey =
  "baseUrl" | "source" | "medium" | "campaign" | "term" | "content";

const UTM_FIELDS: {
  key: UtmFieldKey;
  label: string;
  placeholder: string;
  required: boolean;
}[] = [
  {
    key: "baseUrl",
    label: "URL",
    placeholder: "https://example.com/post",
    required: true,
  },
  { key: "source", label: "Source", placeholder: "instagram", required: true },
  { key: "medium", label: "Medium", placeholder: "social", required: true },
  {
    key: "campaign",
    label: "Campaign",
    placeholder: "spring_launch",
    required: true,
  },
  { key: "term", label: "Term", placeholder: "optional", required: false },
  {
    key: "content",
    label: "Content",
    placeholder: "optional",
    required: false,
  },
];

const EMPTY_UTM: Record<UtmFieldKey, string> = {
  baseUrl: "",
  source: "",
  medium: "",
  campaign: "",
  term: "",
  content: "",
};

function UtmBuilderPopover({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<UtmFieldKey, string>>(EMPTY_UTM);
  const [errors, setErrors] = useState<Partial<Record<UtmFieldKey, string>>>(
    {},
  );

  function reset() {
    setValues(EMPTY_UTM);
    setErrors({});
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = utmFormSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors;
      const next: Partial<Record<UtmFieldKey, string>> = {};
      for (const field of UTM_FIELDS) {
        const message = fieldErrors[field.key]?.[0];
        if (message) next[field.key] = message;
      }
      setErrors(next);
      return;
    }
    onInsert(buildUtmUrl(parsed.data.baseUrl, parsed.data));
    reset();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Insert tracked link"
          >
            <Link2 />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-80">
        <form
          className="flex flex-col gap-2.5"
          onSubmit={handleSubmit}
          noValidate
        >
          <p className="text-sm font-medium">Insert tracked link</p>
          {UTM_FIELDS.map((field) => {
            const inputId = `utm-${field.key}`;
            const error = errors[field.key];
            return (
              <div key={field.key} className="flex flex-col gap-1">
                <Label htmlFor={inputId} className="text-xs">
                  {field.label}
                  {field.required ? null : (
                    <span className="text-muted-foreground"> (optional)</span>
                  )}
                </Label>
                <Input
                  id={inputId}
                  type={field.key === "baseUrl" ? "url" : "text"}
                  value={values[field.key]}
                  placeholder={field.placeholder}
                  aria-invalid={error ? true : undefined}
                  onChange={(event) =>
                    setValues((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
                />
                {error ? (
                  <span className="text-xs text-destructive">{error}</span>
                ) : null}
              </div>
            );
          })}
          <Button type="submit" size="sm" className="mt-1">
            Insert link
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
