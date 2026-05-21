import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { db } from "../db";
import { buildRenderInput, MissingPrerequisiteError } from "./build-input";

/**
 * `buildRenderInput` is the pure-data step in the Phase 6 render pipeline. We
 * cover: shape conversion (DB → RenderInput), absolute-path resolution,
 * durationFrames math, and the actionable errors thrown when prereqs are
 * missing.
 */

describe("buildRenderInput", () => {
  let scriptId: string;
  let photoAssetId: string;
  let videoAssetId: string;
  let chartAssetId: string;

  beforeEach(async () => {
    await db.apiUsage.deleteMany();
    await db.pexelsCache.deleteMany();
    await db.asset.deleteMany();
    await db.render.deleteMany();
    await db.script.deleteMany();
    await db.suggestion.deleteMany();
    await db.idea.deleteMany();
    await db.trendSnapshot.deleteMany();
    await db.chapter.deleteMany();
    await db.book.deleteMany();
    await db.job.deleteMany();
    await db.setting.deleteMany();

    const book = await db.book.create({
      data: { title: "Finance", filePath: "/tmp/x.pdf", niche: "investing", pageCount: 1, status: "ready" },
    });
    const chapter = await db.chapter.create({
      data: { bookId: book.id, title: "C1", orderIndex: 0, startPage: 0, endPage: 0, rawText: "x", status: "extracted" },
    });
    const idea = await db.idea.create({
      data: { chapterId: chapter.id, title: "T", summary: "S", targetLengthSec: 30, status: "scripted" },
    });

    const photoAsset = await db.asset.create({
      data: { type: "pexels_photo", localPath: "output/cache/photo.jpg", width: 1080, height: 1920 },
    });
    photoAssetId = photoAsset.id;
    const videoAsset = await db.asset.create({
      data: { type: "pexels_video", localPath: "output/cache/clip.mp4", width: 1080, height: 1920, durationSec: 12 },
    });
    videoAssetId = videoAsset.id;
    const chartAsset = await db.asset.create({
      data: { type: "pexels_photo", localPath: "output/cache/numbers.jpg", width: 1080, height: 1920 },
    });
    chartAssetId = chartAsset.id;

    const script = await db.script.create({
      data: {
        ideaId: idea.id,
        hook: "Most people miss the real lever of wealth",
        body: "It is time, multiplied by consistency.",
        cta: "Start now.",
        visualBeats: [
          { start: 0, end: 3, keywords: ["clock"], mediaType: "photo", tone: "urgent", pickedAssetId: photoAssetId },
          { start: 3, end: 10, keywords: ["forest"], mediaType: "video", tone: "explainer", pickedAssetId: videoAssetId },
          {
            start: 10,
            end: 12,
            keywords: ["chart"],
            mediaType: "photo",
            tone: "payoff",
            pickedAssetId: chartAssetId,
            chart: { kind: "stat", label: "growth", bigNumber: "8%" },
          },
        ],
        metadata: {
          youtubeTitle: "8% growth, every year",
          caption: "compound math beats income",
          hashtags: ["#money", "#finance"],
          thumbnailConcept: "stack of bills with arrow",
        },
        status: "approved",
      },
    });
    scriptId = script.id;

    await db.render.create({
      data: {
        scriptId,
        audioPath: "/tmp/audio.wav",
        captionsPath: "/tmp/captions.json",
        durationSec: 12.0,
        fileSizeMB: 0.5,
        status: "done",
        progress: 100,
      },
    });
  });

  it("happy path: 3-beat fixture (photo + video + chart) maps to the expected RenderInput", async () => {
    const input = await buildRenderInput({
      scriptId,
      readCaptions: async () => ({
        words: [
          { word: "most", start: 0, end: 0.4 },
          { word: "people", start: 0.4, end: 1.0 },
          { word: "miss", start: 1.0, end: 11.5 },
        ],
      }),
    });

    expect(input.scriptId).toBe(scriptId);
    expect(input.fps).toBe(30);
    expect(input.width).toBe(1080);
    expect(input.height).toBe(1920);
    expect(input.theme).toBe("finance-dark");

    expect(input.visualBeats).toHaveLength(3);
    expect(input.visualBeats[0]!.assetType).toBe("photo");
    expect(input.visualBeats[1]!.assetType).toBe("video");
    expect(input.visualBeats[2]!.assetType).toBe("photo");
    expect(input.visualBeats[2]!.chart).toEqual({ kind: "stat", label: "growth", bigNumber: "8%" });

    expect(input.captions.words).toHaveLength(3);
    expect(input.metadata.hashtags).toEqual(["#money", "#finance"]);
    expect(input.metadata.youtubeTitle).toBe("8% growth, every year");
    expect(input.hookText).toMatch(/Most people miss/);
    expect(input.ctaText).toBe("Start now.");
  });

  it("resolves every asset path to an absolute path", async () => {
    const input = await buildRenderInput({
      scriptId,
      readCaptions: async () => ({ words: [{ word: "x", start: 0, end: 12 }] }),
    });
    for (const beat of input.visualBeats) {
      expect(path.isAbsolute(beat.assetPath)).toBe(true);
    }
    expect(path.isAbsolute(input.audioPath)).toBe(true);
  });

  it("durationFrames = round(lastWordEnd * 30), clamped up to max(audio, lastBeat) * 30", async () => {
    // lastWordEnd 11.7 → 351 frames base
    // audioDur 12.0 → 360 frames upper-clamp
    // lastBeatEnd 12.0 → 360
    // Expect: max-clamp dominates → 360
    const input = await buildRenderInput({
      scriptId,
      readCaptions: async () => ({ words: [{ word: "x", start: 0, end: 11.7 }] }),
    });
    expect(input.durationFrames).toBe(360);
  });

  it("durationFrames rounds correctly for non-integer last-word boundaries", async () => {
    // Bump audio down so we test the inner round path.
    await db.render.update({
      where: { scriptId },
      data: { durationSec: 10 },
    });
    await db.script.update({
      where: { id: scriptId },
      data: {
        visualBeats: [
          { start: 0, end: 5, mediaType: "photo", tone: "urgent", pickedAssetId: photoAssetId },
          { start: 5, end: 10, mediaType: "photo", tone: "payoff", pickedAssetId: chartAssetId },
        ],
      },
    });
    // lastWordEnd 9.51 → round → 285
    const input = await buildRenderInput({
      scriptId,
      readCaptions: async () => ({ words: [{ word: "y", start: 0, end: 9.51 }] }),
    });
    // ceil(10 * 30) = 300 clamps the value up
    expect(input.durationFrames).toBe(300);
  });

  it("throws MissingPrerequisiteError when audio is missing", async () => {
    await db.render.update({ where: { scriptId }, data: { audioPath: null } });
    await expect(buildRenderInput({ scriptId, readCaptions: async () => ({ words: [] }) }))
      .rejects.toThrow(/audio/);
  });

  it("throws MissingPrerequisiteError when captions are missing", async () => {
    await db.render.update({ where: { scriptId }, data: { captionsPath: null } });
    await expect(buildRenderInput({ scriptId, readCaptions: async () => ({ words: [] }) }))
      .rejects.toThrow(/captions/);
  });

  it("throws MissingPrerequisiteError with the beat index when a pickedAssetId is null", async () => {
    await db.script.update({
      where: { id: scriptId },
      data: {
        visualBeats: [
          { start: 0, end: 3, mediaType: "photo", tone: "urgent", pickedAssetId: photoAssetId },
          { start: 3, end: 10, mediaType: "video", tone: "explainer", pickedAssetId: null },
          { start: 10, end: 12, mediaType: "photo", tone: "payoff", pickedAssetId: chartAssetId },
        ],
      },
    });
    try {
      await buildRenderInput({
        scriptId,
        readCaptions: async () => ({ words: [{ word: "x", start: 0, end: 12 }] }),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingPrerequisiteError);
      expect((err as MissingPrerequisiteError).missing).toBe("pickedAsset:1");
    }
  });

  it("throws when a beat references a now-deleted Asset row", async () => {
    await db.asset.delete({ where: { id: videoAssetId } });
    await expect(
      buildRenderInput({
        scriptId,
        readCaptions: async () => ({ words: [{ word: "x", start: 0, end: 12 }] }),
      })
    ).rejects.toThrow(/missing Asset/);
  });

  it("supports passing theme=finance-light", async () => {
    const input = await buildRenderInput({
      scriptId,
      theme: "finance-light",
      readCaptions: async () => ({ words: [{ word: "x", start: 0, end: 12 }] }),
    });
    expect(input.theme).toBe("finance-light");
  });
});
