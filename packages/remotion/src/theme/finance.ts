import type { ThemeTokens } from "./tokens";
import type { Theme } from "../data/types";

export const financeDark: ThemeTokens = {
  bg: "#0B0F1A",
  textPrimary: "#FFFFFF",
  textHighlight: "#00FF85",
  accent: "#FFD700",
  font: "Inter",
  captionSize: 96,
  captionStroke: 8,
  captionPosition: "bottom-third",
  bRollKenBurns: { from: 1.0, to: 1.08, durationSec: 4 },
  enterEasing: "easeOutBack",
};

/** Stubbed light theme — not exercised by Phase 6 acceptance. */
export const financeLight: ThemeTokens = {
  ...financeDark,
  bg: "#F4F6FA",
  textPrimary: "#0B0F1A",
  textHighlight: "#0F8F4E",
  accent: "#B47A00",
};

export function themeFor(name: Theme): ThemeTokens {
  return name === "finance-light" ? financeLight : financeDark;
}
