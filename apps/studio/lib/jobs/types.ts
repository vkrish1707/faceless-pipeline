export type JobType =
  | "extract_ideas"
  | "score_chapter"
  | "generate_script"
  | "rescore_script"
  | "synthesize_script"
  | "fetch_broll";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  ctx: { jobId: string; updateProgress: (n: number) => Promise<void> }
) => Promise<TResult>;
