import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type PipelineCounts = {
  books: number;
  ideas: number;
  scripts: number;
  audios: number;
  brollPicked: number;
  renders: number;
};

const STEPS: Array<{
  label: string;
  hint: string;
  href: string;
  cta: string;
  countFor: keyof PipelineCounts;
}> = [
  { label: "1 · Upload", hint: "Drop a PDF to get chapters", href: "/books/new", cta: "Upload", countFor: "books" },
  { label: "2 · Extract", hint: "Per chapter → 3-8 ideas", href: "/books", cta: "Open book", countFor: "ideas" },
  { label: "3 · Score", hint: "Color-coded ideas + suggestions", href: "/books", cta: "Score", countFor: "ideas" },
  { label: "4 · Script", hint: "Approve ideas → editable scripts", href: "/books", cta: "Scripts", countFor: "scripts" },
  { label: "5 · Voice + b-roll", hint: "Synth + pick beat thumbnails", href: "/books", cta: "Pick", countFor: "audios" },
  { label: "6 · Render", hint: "1080×1920 MP4 with captions", href: "/renders", cta: "Renders", countFor: "renders" },
];

export function PipelineGuide({ counts }: { counts: PipelineCounts }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline at a glance</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Each step unlocks the next. Counts are across all books.
        </p>
      </CardHeader>
      <CardContent>
        <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {STEPS.map((s) => {
            const n = counts[s.countFor];
            const done = n > 0;
            return (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2 hover:border-primary/60 hover:bg-card/40 transition"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.hint}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={done ? "success" : "outline"}>{n}</Badge>
                    <span className="text-xs text-muted-foreground">→</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
