"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Check = { name: string; ok: boolean; path?: string; detail?: string };
type HealthResponse = { status: "ok" | "degraded"; checks: Check[] };

export function SystemStatus() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>System status</CardTitle>
        <div className="flex items-center gap-3">
          {data && (
            <Badge variant={data.status === "ok" ? "success" : "warn"}>{data.status}</Badge>
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
            {data.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between border-b border-border py-2">
                <div>
                  <div className="font-medium">{c.name}</div>
                  {c.path && <div className="text-xs text-muted-foreground">{c.path}</div>}
                </div>
                <Badge variant={c.ok ? "success" : "error"}>{c.ok ? "ok" : (c.detail ?? "missing")}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
