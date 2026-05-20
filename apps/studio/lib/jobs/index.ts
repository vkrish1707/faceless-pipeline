import { registerHandler } from "./runner";
import { handleExtractIdeas } from "./handlers/extract-ideas";
import { handleScoreChapter } from "./handlers/score-chapter";
import { handleGenerateScript } from "./handlers/generate-script";
import { handleRescoreScript } from "./handlers/rescore-script";

let registered = false;
export function ensureHandlersRegistered(): void {
  if (registered) return;
  registerHandler("extract_ideas", handleExtractIdeas);
  registerHandler("score_chapter", handleScoreChapter);
  registerHandler("generate_script", handleGenerateScript);
  registerHandler("rescore_script", handleRescoreScript);
  registered = true;
}

export { runJob, enqueueAndRun, recoverOrphans } from "./runner";
