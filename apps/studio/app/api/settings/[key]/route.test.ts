import { describe, it, expect, beforeEach } from "vitest";
import { PATCH, GET } from "./route";
import { db } from "../../../../lib/db";

async function clear() {
  await db.setting.deleteMany();
}

function req(body: unknown): Request {
  return new Request("http://test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH/GET /api/settings/[key]", () => {
  beforeEach(async () => {
    await clear();
  });

  it("404 on unknown key", async () => {
    const res = await PATCH(req({ value: "x" }), { params: Promise.resolve({ key: "unknown_thing" }) });
    expect(res.status).toBe(404);
  });

  it("enable_music: accepts 'true'/'false'", async () => {
    const ok = await PATCH(req({ value: "true" }), { params: Promise.resolve({ key: "enable_music" }) });
    expect(ok.status).toBe(200);
    const row = await db.setting.findUniqueOrThrow({ where: { key: "enable_music" } });
    expect(row.value).toBe("true");

    const bad = await PATCH(req({ value: "yes" }), { params: Promise.resolve({ key: "enable_music" }) });
    expect(bad.status).toBe(400);
  });

  it("render_concurrency: clamps to 1–4 and 400s on out-of-range", async () => {
    const ok = await PATCH(req({ value: "3" }), { params: Promise.resolve({ key: "render_concurrency" }) });
    expect(ok.status).toBe(200);

    const bad1 = await PATCH(req({ value: "0" }), { params: Promise.resolve({ key: "render_concurrency" }) });
    expect(bad1.status).toBe(400);
    const bad2 = await PATCH(req({ value: "5" }), { params: Promise.resolve({ key: "render_concurrency" }) });
    expect(bad2.status).toBe(400);
  });

  it("music_gain_db: accepts negative dB, rejects positive", async () => {
    const ok = await PATCH(req({ value: "-15" }), { params: Promise.resolve({ key: "music_gain_db" }) });
    expect(ok.status).toBe(200);
    const bad = await PATCH(req({ value: "5" }), { params: Promise.resolve({ key: "music_gain_db" }) });
    expect(bad.status).toBe(400);
  });

  it("log_level: enum only", async () => {
    const ok = await PATCH(req({ value: "warn" }), { params: Promise.resolve({ key: "log_level" }) });
    expect(ok.status).toBe(200);
    const bad = await PATCH(req({ value: "trace" }), { params: Promise.resolve({ key: "log_level" }) });
    expect(bad.status).toBe(400);
  });

  it("GET returns null when the row is missing", async () => {
    const res = await GET(new Request("http://test"), { params: Promise.resolve({ key: "log_level" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: string | null };
    expect(body.value).toBeNull();
  });
});
