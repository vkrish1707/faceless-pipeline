import { registerHandler } from "./runner";
import { handleExtractIdeas } from "./handlers/extract-ideas";

let registered = false;
export function ensureHandlersRegistered(): void {
  if (registered) return;
  registerHandler("extract_ideas", handleExtractIdeas);
  registered = true;
}

export { runJob, enqueueAndRun, recoverOrphans } from "./runner";
