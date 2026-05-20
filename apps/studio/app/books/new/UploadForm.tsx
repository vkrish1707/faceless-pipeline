"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NICHES = [
  { value: "personal_finance", label: "Personal finance" },
  { value: "investing", label: "Investing" },
  { value: "entrepreneurship", label: "Entrepreneurship" },
  { value: "psychology", label: "Psychology" },
  { value: "other", label: "Other" },
];

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [niche, setNiche] = useState("investing");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("Pick a PDF first.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("niche", niche);
      if (title.trim()) fd.append("title", title.trim());
      const res = await fetch("/api/books", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "upload failed");
      router.push(`/books/${data.bookId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload PDF</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">PDF file</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Niche</label>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              {NICHES.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Title <span className="text-muted-foreground">(optional — defaults to filename)</span></label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="The Psychology of Money"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          <Button type="submit" disabled={submitting || !file}>
            {submitting ? "Uploading..." : "Upload & parse"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
