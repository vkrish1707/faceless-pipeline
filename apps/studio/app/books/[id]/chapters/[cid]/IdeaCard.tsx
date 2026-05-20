"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function IdeaCard({
  title,
  summary,
  targetLengthSec,
  sourceQuotes,
  candidateHooks,
}: {
  title: string;
  summary: string;
  targetLengthSec: number;
  sourceQuotes: string[];
  candidateHooks: string[];
}) {
  const [showQuotes, setShowQuotes] = useState(false);
  const [showHooks, setShowHooks] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <CardTitle className="text-base leading-snug">{title}</CardTitle>
        <Badge variant="outline">{targetLengthSec}s</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{summary}</p>
        <div className="space-y-1">
          <button onClick={() => setShowHooks((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showHooks ? "▾" : "▸"} candidate hooks ({candidateHooks.length})
          </button>
          {showHooks && (
            <ul className="text-xs space-y-1 ml-3">
              {candidateHooks.map((h, i) => (
                <li key={i} className="text-muted-foreground">— {h}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-1">
          <button onClick={() => setShowQuotes((s) => !s)} className="text-xs text-muted-foreground hover:text-foreground">
            {showQuotes ? "▾" : "▸"} source quotes ({sourceQuotes.length})
          </button>
          {showQuotes && (
            <ul className="text-xs space-y-1 ml-3">
              {sourceQuotes.map((q, i) => (
                <li key={i} className="text-muted-foreground italic">&quot;{q}&quot;</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
