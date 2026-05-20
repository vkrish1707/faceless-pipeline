function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

export function shouldRescore(before: string, after: string, threshold = 0.05): boolean {
  const aTrim = before.trim();
  const bTrim = after.trim();
  if (aTrim === bTrim) return false;
  if (aTrim.replace(/\s+/g, " ") === bTrim.replace(/\s+/g, " ")) return false;
  const base = Math.max(aTrim.length, 1);
  const dist = levenshtein(aTrim, bTrim);
  return dist / base >= threshold;
}
