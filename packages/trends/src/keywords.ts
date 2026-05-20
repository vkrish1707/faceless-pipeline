const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "by", "from", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "as", "into", "than", "then",
  "so", "if", "not", "no", "do", "does", "did", "have", "has", "had", "i",
  "you", "we", "they", "he", "she", "his", "her", "their", "our", "your",
  "about", "after", "before", "over", "under", "again", "more", "less",
  "what", "when", "where", "which", "who", "why", "how", "can", "will",
  "just", "also", "very", "many", "much", "some", "any", "all", "such",
]);

const PHRASE_RE = /\b([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,4})\b/g;

type IdeaInput = { title: string };

export type ExtractKeywordsOpts = {
  cap?: number;
};

export function extractKeywords(
  chapterText: string,
  ideas: IdeaInput[],
  opts: ExtractKeywordsOpts = {}
): string[] {
  const cap = opts.cap ?? 12;
  const seen = new Map<string, number>();

  const pushPhrase = (raw: string, priorityBoost: number) => {
    const cleaned = cleanPhrase(raw);
    if (!cleaned) return;
    if (cleaned.length < 4 || cleaned.length > 60) return;
    const key = cleaned;
    const prev = seen.get(key) ?? -1;
    if (priorityBoost > prev) seen.set(key, priorityBoost);
  };

  for (const idea of ideas) {
    for (const phrase of findPhrases(idea.title, 20)) pushPhrase(phrase, 2);
  }

  for (const phrase of findPhrases(chapterText, 30)) pushPhrase(phrase, 1);

  const ordered = Array.from(seen.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([k]) => k);

  return ordered.slice(0, cap);
}

function findPhrases(text: string, limit: number): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  PHRASE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHRASE_RE.exec(lower)) !== null) {
    out.push(m[1]!);
    if (out.length >= limit) break;
  }
  return out;
}

function cleanPhrase(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  return tokens.join(" ");
}
