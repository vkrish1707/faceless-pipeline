/**
 * Binary-search helper used by the audio preview to find which word should
 * be highlighted at the current playback time.
 */
export type ActiveWord = { start: number; end: number };

/**
 * Returns the index of the word whose [start, end] interval contains `t`.
 *
 * Conventions (matched in tests):
 *   - empty words array        → -1
 *   - t before first word.start → -1
 *   - t after last word.end     → last index (sticky to last word)
 *   - t exactly at word.end     → that word's index (end is inclusive)
 *
 * O(log n).
 */
export function activeWordIndex(words: ReadonlyArray<ActiveWord>, t: number): number {
  if (words.length === 0) return -1;
  const first = words[0]!;
  const last = words[words.length - 1]!;
  if (t < first.start) return -1;
  if (t > last.end) return words.length - 1;

  // Find the smallest index `i` where words[i].end >= t.
  // - If words[i].start <= t, then t lies inside [start, end] — return i.
  // - Else t is in a gap before word i; the most-recently-finished word is
  //   i - 1 (>= 0 since t >= first.start). Return i - 1.
  // Ties at word.end resolve to the earlier word, since we take the smallest
  // index with end >= t.
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (words[mid]!.end >= t) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  const candidate = words[lo]!;
  if (candidate.start <= t) return lo;
  return lo - 1;
}
