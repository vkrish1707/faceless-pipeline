/**
 * Theme token shape. Two concrete themes live next to this file: `finance.ts`
 * exports `financeDark` (the only theme exercised by Phase 6 acceptance) and a
 * stub `financeLight` for future expansion. Components import via
 * `themeFor(themeName)` so swapping themes is a single string in
 * `RenderInput.theme`.
 */

export type ThemeTokens = {
  bg: string;
  textPrimary: string;
  textHighlight: string;
  accent: string;
  font: string;
  captionSize: number;
  captionStroke: number;
  captionPosition: "bottom-third" | "center";
  bRollKenBurns: { from: number; to: number; durationSec: number };
  enterEasing: string;
};
