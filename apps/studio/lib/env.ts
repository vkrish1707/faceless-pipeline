import { z } from "zod";

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20),
  PEXELS_API_KEY: z.string().min(10),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\n\nCopy .env.local.example to .env.local and fill in values.`);
  }
  cached = parsed.data;
  return cached;
}

export function maskedEnv() {
  const e = getEnv();
  return {
    anthropic: e.ANTHROPIC_API_KEY.slice(0, 8) + "..." + e.ANTHROPIC_API_KEY.slice(-4),
    pexels: e.PEXELS_API_KEY.slice(0, 4) + "..." + e.PEXELS_API_KEY.slice(-4),
    logLevel: e.LOG_LEVEL,
    renderConcurrency: e.RENDER_CONCURRENCY,
  };
}
