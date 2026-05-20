import { registerHandler } from "./runner";
import { handleExtractIdeas } from "./handlers/extract-ideas";
import { handleScoreChapter } from "./handlers/score-chapter";

let registered = false;
export function ensureHandlersRegistered(): void {
  if (registered) return;
  registerHandler("extract_ideas", handleExtractIdeas);
  registerHandler("score_chapter", handleScoreChapter);
  registered = true;
}

export { runJob, enqueueAndRun, recoverOrphans } from "./runner";
