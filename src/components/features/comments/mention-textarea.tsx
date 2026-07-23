"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** A member who can be @-mentioned. */
export type MentionMember = { id: string; name: string };

/**
 * A comment textarea with an @-mention typeahead (E3). The visible text shows
 * mentions as plain `@Name`; the parent converts the display text + the set of
 * inserted mentions into the stored `@[Name](id)` body at submit time
 * (buildBodyFromDisplay). Base UI primitives only — a lightweight dropdown
 * anchored under the field, not a full combobox, to keep it dependency-free.
 */
export function MentionTextarea({
  value,
  onChange,
  members,
  onMention,
  placeholder,
  disabled,
  rows = 3,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  /** Called when a member is picked from the typeahead. */
  onMention: (member: MentionMember) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // The active "@query" span in the text, or null when not mentioning.
  const [query, setQuery] = useState<{ text: string; start: number } | null>(
    null,
  );
  const [active, setActive] = useState(0);

  /** Detect an "@token" immediately before the caret (no whitespace inside). */
  function detectQuery(text: string, caret: number) {
    const upto = text.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(upto);
    if (!match) return null;
    return { text: match[1], start: caret - match[1].length - 1 };
  }

  function handleChange(next: string) {
    onChange(next);
    const caret = ref.current?.selectionStart ?? next.length;
    const q = detectQuery(next, caret);
    setQuery(q);
    setActive(0);
  }

  const matches = query
    ? members
        .filter((m) => m.name.toLowerCase().includes(query.text.toLowerCase()))
        .slice(0, 6)
    : [];

  function pick(member: MentionMember) {
    if (!query) return;
    // Replace "@query" with "@Name " (trailing space ends the token).
    const before = value.slice(0, query.start);
    const after = value.slice(query.start + query.text.length + 1);
    const next = `${before}@${member.name} ${after}`;
    onChange(next);
    onMention(member);
    setQuery(null);
    // Restore focus + caret after the inserted mention.
    const caret = before.length + member.name.length + 2;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay so an onMouseDown pick lands before the list unmounts.
          requestAnimationFrame(() => setQuery(null));
        }}
      />
      {matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                // onMouseDown (not onClick) so it fires before the textarea blur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-sm",
                  i === active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
