import { SystemStatus } from "@/components/system-status";

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Faceless Pipeline</h1>
        <p className="text-muted-foreground mt-1">Local-first studio (Phase 0 scaffold)</p>
      </header>
      <SystemStatus />
    </main>
  );
}
