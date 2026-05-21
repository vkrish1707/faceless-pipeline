/**
 * Lightweight logging helper. Wraps console.log/warn/error and *also*
 * appends a one-line-per-event JSONL record to `logs/studio-<today>.log`
 * when `STUDIO_LOG_FILE` is truthy.
 *
 * Phase 7 introduces this as a foundation for the /admin/logs page — but
 * does NOT refactor the codebase's existing `console.log` calls; existing
 * call sites still go to stdout. New code can opt-in by importing `log`.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

export type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function levelEnv(): Level {
  const e = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (e === "debug" || e === "info" || e === "warn" || e === "error") return e;
  return "info";
}

function shouldLog(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[levelEnv()];
}

function todayLogFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.resolve(`logs/studio-${yyyy}-${mm}-${dd}.log`);
}

export function logLine(level: Level, event: string, extra: Record<string, unknown> = {}): void {
  if (!shouldLog(level)) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...extra,
  };
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(record));
  if (process.env.STUDIO_LOG_FILE === "1" || process.env.STUDIO_LOG_FILE === "true") {
    try {
      const file = todayLogFile();
      const dir = path.dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(file, JSON.stringify(record) + "\n");
    } catch {
      // never crash on log failures
    }
  }
}

export const log = {
  debug: (event: string, extra?: Record<string, unknown>) => logLine("debug", event, extra),
  info: (event: string, extra?: Record<string, unknown>) => logLine("info", event, extra),
  warn: (event: string, extra?: Record<string, unknown>) => logLine("warn", event, extra),
  error: (event: string, extra?: Record<string, unknown>) => logLine("error", event, extra),
};

export function currentLogFile(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return path.resolve(`logs/studio-${yyyy}-${mm}-${dd}.log`);
}
