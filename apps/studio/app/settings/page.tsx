import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { DEFAULT_VOICE, VOICE_ALLOWLIST, VOICE_DIR } from "@/lib/jobs/handlers/synthesize-script";
import { VoicePicker, type VoiceOption } from "./VoicePicker";

export const dynamic = "force-dynamic";

const VOICE_LABELS: Record<string, { label: string; description: string }> = {
  "en_US-ryan-high": { label: "Ryan (US)", description: "Male, authoritative — Piper en_US-ryan-high" },
  "en_US-amy-medium": { label: "Amy (US)", description: "Female, clear — Piper en_US-amy-medium" },
};

export default async function SettingsPage() {
  const row = await db.setting.findUnique({ where: { key: "default_voice" } });
  const current = row?.value ?? DEFAULT_VOICE;

  const voices: VoiceOption[] = VOICE_ALLOWLIST.map((v) => {
    const meta = VOICE_LABELS[v] ?? { label: v, description: v };
    const modelPath = path.resolve(VOICE_DIR, `${v}.onnx`);
    return {
      id: v,
      label: meta.label,
      description: meta.description,
      installed: existsSync(modelPath),
      sampleUrl: `/assets/voices/samples/${v}.wav`,
    };
  });

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-1">Local studio configuration</p>
      </header>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Default voice</h2>
        <p className="text-sm text-muted-foreground">
          Used for every <code>Synthesize</code> action. Switching does not invalidate existing renders.
        </p>
        <VoicePicker voices={voices} current={current} />
      </section>
    </main>
  );
}
