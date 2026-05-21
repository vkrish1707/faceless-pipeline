"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Check = { name: string; ok: boolean; path?: string; detail?: string; help?: string };
type Group = { name: string; checks: Check[]; status: "ok" | "degraded" };
type HealthResponse = { status: "ok" | "degraded"; groups: Group[] };

export function SystemStatus() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const json: HealthResponse = await res.json();
      setData(json);
      // Auto-expand any degraded group on first load so problems are visible.
      setOpen((prev) =>
        Object.keys(prev).length > 0
          ? prev
          : Object.fromEntries(json.groups.map((g) => [g.name, g.status !== "ok"]))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const toggle = (name: string) => setOpen((p) => ({ ...p, [name]: !p[name] }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>System status</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Required for the pipeline to run end-to-end. Background music is optional.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <Badge variant={data.status === "ok" ? "success" : "warn"}>
              {data.status === "ok" ? "all required ready" : "setup needed"}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "Checking..." : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className="text-muted-foreground">Loading checks...</p>
        ) : (
          <ul className="space-y-2">
            {data.groups.map((g) => {
              const isOpen = open[g.name] ?? false;
              const missing = g.checks.filter((c) => !c.ok).length;
              return (
                <li key={g.name} className="border border-border rounded">
                  <button
                    onClick={() => toggle(g.name)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-card/40"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{isOpen ? "▾" : "▸"}</span>
                      <span className="font-medium text-sm">{g.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {g.checks.length - missing}/{g.checks.length}
                      </span>
                      <Badge variant={g.status === "ok" ? "success" : "warn"}>{g.status}</Badge>
                    </div>
                  </button>
                  {isOpen && (
                    <ul className="px-3 pb-3 space-y-1 border-t border-border bg-card/20">
                      {g.checks.map((c) => (
                        <li key={c.name} className="flex items-start justify-between gap-3 py-2 border-b border-border/40 last:border-b-0">
                          <div className="min-w-0">
                            <div className="text-sm font-mono">{c.name}</div>
                            {c.path && (
                              <div className="text-[10px] text-muted-foreground truncate">{c.path}</div>
                            )}
                            {!c.ok && c.help && (
                              <div className="text-xs text-yellow-200/80 mt-1">{c.help}</div>
                            )}
                          </div>
                          <Badge variant={c.ok ? "success" : "error"} className="shrink-0">
                            {c.ok ? "ok" : c.detail ?? "missing"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
