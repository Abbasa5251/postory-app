"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;
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

  // All name-matching members (no cap) — the listbox is height-bounded and
  // scrolls (max-h-48 overflow-y-auto), so a large team stays usable.
  const matches = query
    ? members.filter((m) =>
        m.name.toLowerCase().includes(query.text.toLowerCase()),
      )
    : [];
  const open = matches.length > 0;

  // The listbox is rendered in a portal with FIXED positioning so it isn't
  // clipped by an ancestor's overflow (the composer's Discussion card, the
  // approvals dialog's scroll area). Track the textarea's viewport rect and keep
  // the popup aligned to it on scroll/resize.
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  useEffect(() => {
    // Only measure while open; the portal render also guards on `open`, so a
    // stale rect from a previous open never shows (no setState-on-close needed).
    if (!open) return;
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    // `capture` so a scroll in ANY ancestor (the dialog/card) repositions it.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, query]);

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
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          matches.length > 0 ? optionId(active) : undefined
        }
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay so an onMouseDown pick lands before the list unmounts.
          requestAnimationFrame(() => setQuery(null));
        }}
      />
      {open &&
        rect &&
        createPortal(
          <ul
            id={listboxId}
            role="listbox"
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              // Cap at a menu-like width; shrink to the field only when narrower
              // (don't stretch across a full-width composer textarea).
              width: Math.min(rect.width, 288),
            }}
            className="z-50 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {matches.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
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
          </ul>,
          document.body,
        )}
    </div>
  );
}
