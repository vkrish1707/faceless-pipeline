"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type IdeaCardProps = {
  title: string;
  summary: string;
  targetLengthSec: number;
  sourceQuotes: string[];
  candidateHooks: string[];
  score: number | null;
  breakdown: {
    hook_strength: number;
    specificity: number;
    trend_alignment: number;
    format_fit: number;
    shelf_life: number;
  } | null;
  trendsPartial: boolean;
  approvable?: boolean;
  approved?: boolean;
  onToggleApprove?: () => void;
};

export function IdeaCard({
  title,
  summary,
  targetLengthSec,
  sourceQuotes,
  candidateHooks,
  score,
  breakdown,
  trendsPartial,
  approvable = false,
  approved = false,
  onToggleApprove,
}: IdeaCardProps) {
  const [showQuotes, setShowQuotes] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const scoreVariant = score == null ? "outline" : score >= 80 ? "success" : score >= 60 ? "warn" : "outline";

  return (
    <Card className={approved ? "ring-2 ring-green-500/50" : ""}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {approvable && (
            <label className="flex items-center gap-1 mt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={approved}
                onChange={onToggleApprove}
                className="h-4 w-4 rounded border-border accent-green-500"
              />
            </label>
          )}
          <CardTitle className="text-base leading-snug">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {trendsPartial && (
            <span
              className="text-[10px] uppercase tracking-wide text-yellow-300/80"
              title="One or more trend sources returned no data for this idea"
            >
              trends partial
            </span>
          )}
          {score != null && breakdown ? (
            <button
              onClick={() => setShowBreakdown((s) => !s)}
              className="focus:outline-none"
              aria-label="show score breakdown"
            >
              <Badge variant={scoreVariant} className="cursor-pointer">{score}</Badge>
            </button>
          ) : (
            <Badge variant="outline">unscored</Badge>
          )}
          <Badge variant="outline">{targetLengthSec}s</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showBreakdown && breakdown && (
          <ul className="text-xs grid grid-cols-2 gap-x-3 gap-y-1 bg-muted/40 rounded p-2">
            <li><span className="text-muted-foreground">hook</span> {breakdown.hook_strength}/25</li>
            <li><span className="text-muted-foreground">specificity</span> {breakdown.specificity}/20</li>
            <li><span className="text-muted-foreground">trend</span> {breakdown.trend_alignment}/25</li>
            <li><span className="text-muted-foreground">format</span> {breakdown.format_fit}/15</li>
            <li><span className="text-muted-foreground">shelf life</span> {breakdown.shelf_life}/15</li>
          </ul>
        )}
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
