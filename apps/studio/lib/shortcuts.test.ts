import { describe, it, expect } from "vitest";
import { match, isEditableTarget, DEFAULT_SHORTCUTS } from "./shortcuts";

describe("isEditableTarget", () => {
  it("returns true for input/textarea/select", () => {
    const input = { tagName: "INPUT", isContentEditable: false } as unknown as Element;
    const ta = { tagName: "TEXTAREA", isContentEditable: false } as unknown as Element;
    const sel = { tagName: "SELECT", isContentEditable: false } as unknown as Element;
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(ta)).toBe(true);
    expect(isEditableTarget(sel)).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = { tagName: "DIV", isContentEditable: true } as unknown as Element;
    expect(isEditableTarget(div)).toBe(true);
  });

  it("returns false for normal elements", () => {
    const div = { tagName: "DIV", isContentEditable: false } as unknown as Element;
    expect(isEditableTarget(div)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("match", () => {
  it("single-keystroke matches return match immediately", () => {
    const res = match("r", null, DEFAULT_SHORTCUTS);
    expect(res.kind).toBe("match");
    if (res.kind === "match") expect(res.shortcut.keys).toBe("r");
  });

  it("chord prefix returns partial with the pending key", () => {
    const res = match("g", null, DEFAULT_SHORTCUTS);
    expect(res.kind).toBe("partial");
    if (res.kind === "partial") expect(res.pendingPrefix).toBe("g");
  });

  it("chord completion fires the chord shortcut", () => {
    const first = match("g", null, DEFAULT_SHORTCUTS);
    expect(first.kind).toBe("partial");
    if (first.kind !== "partial") return;
    const second = match("r", first.pendingPrefix, DEFAULT_SHORTCUTS);
    expect(second.kind).toBe("match");
    if (second.kind === "match") expect(second.shortcut.keys).toBe("g r");
  });

  it("unknown keys return none", () => {
    expect(match("z", null, DEFAULT_SHORTCUTS).kind).toBe("none");
  });

  it("? opens the shortcuts modal", () => {
    const res = match("?", null, DEFAULT_SHORTCUTS);
    expect(res.kind).toBe("match");
  });
});
