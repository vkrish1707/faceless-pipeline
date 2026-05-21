/**
 * Pure keyboard-shortcut registry. The provider component
 * (`components/ShortcutsProvider.tsx`) wraps this in a useEffect that
 * subscribes to `keydown` and dispatches matching handlers.
 *
 * Shortcuts are intentionally minimal: single-keystroke bindings only
 * fire when no input is focused; chord bindings (`g r`) require a second
 * key within a short window.
 */

export type ShortcutHandler = (ctx: { router: { push: (href: string) => void } }) => void;

export interface Shortcut {
  /**
   * Either a single key (e.g. "r", "?") or a chord (e.g. "g r"). Match is
   * case-insensitive against `event.key`.
   */
  keys: string;
  description: string;
  handler: ShortcutHandler;
}

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    keys: "g r",
    description: "Go to /renders dashboard",
    handler: ({ router }) => router.push("/renders"),
  },
  {
    keys: "r",
    description: "Render All on the current chapter page",
    handler: () => {
      if (typeof document === "undefined") return;
      const btn = document.querySelector<HTMLButtonElement>("#render-all");
      btn?.click();
    },
  },
  {
    keys: "o",
    description: "Open output folder for the focused render row",
    handler: () => {
      if (typeof document === "undefined") return;
      const el = document.querySelector<HTMLElement>('[data-shortcut="open-folder"]');
      el?.click();
    },
  },
  {
    keys: "?",
    description: "Show this shortcuts cheatsheet",
    handler: () => {
      if (typeof document === "undefined") return;
      const el = document.querySelector<HTMLDialogElement>("#shortcuts-modal");
      if (el && typeof el.showModal === "function") el.showModal();
    },
  },
];

/**
 * Returns true if `el` is an editable element where typing should not
 * trigger global shortcuts (input, textarea, contenteditable).
 */
export function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * Matches a key sequence against a list of shortcuts. State for chord
 * tracking is opaque and threaded by the caller.
 *
 * Returns either:
 *   - { kind: "match", shortcut } when a complete sequence is matched.
 *   - { kind: "partial", pendingPrefix } when the key is the first part of
 *     a chord; caller should hold the prefix and call `match` again on the
 *     next key.
 *   - { kind: "none" } when the key matches nothing.
 */
export type MatchResult =
  | { kind: "match"; shortcut: Shortcut }
  | { kind: "partial"; pendingPrefix: string }
  | { kind: "none" };

export function match(
  key: string,
  pendingPrefix: string | null,
  shortcuts: ReadonlyArray<Shortcut>
): MatchResult {
  const k = key.toLowerCase();
  // If there's a pending chord prefix, try to complete it.
  if (pendingPrefix) {
    const combined = `${pendingPrefix.toLowerCase()} ${k}`;
    for (const s of shortcuts) {
      if (s.keys.toLowerCase() === combined) {
        return { kind: "match", shortcut: s };
      }
    }
    // No completion; fall through and try a fresh single-key match instead
    // of bailing — the user's second key might be its own binding.
  }
  // Look for an exact single-key match first.
  for (const s of shortcuts) {
    if (s.keys.toLowerCase() === k) {
      return { kind: "match", shortcut: s };
    }
  }
  // Otherwise, see if this key starts a chord.
  for (const s of shortcuts) {
    if (s.keys.toLowerCase().startsWith(`${k} `)) {
      return { kind: "partial", pendingPrefix: k };
    }
  }
  return { kind: "none" };
}
