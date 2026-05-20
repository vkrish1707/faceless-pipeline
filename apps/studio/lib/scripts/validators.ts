export type WarningKind = "word_budget" | "beat_coverage";

export type Warning = {
  kind: WarningKind;
  detail: string;
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function checkWordBudget(
  parts: { hook: string; body: string; cta: string },
  targetLengthSec: number,
  tolerance = 0.1
): { actual: number; target: number; withinTolerance: boolean; overBy: number } {
  const actual = wordCount(parts.hook) + wordCount(parts.body) + wordCount(parts.cta);
  const target = Math.round(targetLengthSec * 2.5);
  const overBy = actual - target;
  const withinTolerance = Math.abs(overBy) <= Math.ceil(target * tolerance);
  return { actual, target, withinTolerance, overBy };
}

export function checkBeatCoverage(
  beats: Array<{ start: number; end: number }>,
  targetLengthSec: number,
  toleranceSec = 1
): { coveredSec: number; target: number; withinTolerance: boolean } {
  const coveredSec = beats.reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
  const withinTolerance = Math.abs(coveredSec - targetLengthSec) <= toleranceSec;
  return { coveredSec, target: targetLengthSec, withinTolerance };
}

export function dedupeHashtags(hashtags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hashtags) {
    const k = h.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

export function buildWarnings(args: {
  hook: string;
  body: string;
  cta: string;
  beats: Array<{ start: number; end: number }>;
  targetLengthSec: number;
}): Warning[] {
  const out: Warning[] = [];
  const wb = checkWordBudget({ hook: args.hook, body: args.body, cta: args.cta }, args.targetLengthSec);
  if (!wb.withinTolerance) {
    out.push({
      kind: "word_budget",
      detail: `${wb.actual} words vs target ${wb.target} (off by ${wb.overBy > 0 ? "+" : ""}${wb.overBy})`,
    });
  }
  const bc = checkBeatCoverage(args.beats, args.targetLengthSec);
  if (!bc.withinTolerance) {
    out.push({
      kind: "beat_coverage",
      detail: `${bc.coveredSec}s of beats vs target ${bc.target}s`,
    });
  }
  return out;
}
