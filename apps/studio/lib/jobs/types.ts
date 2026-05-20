export type JobType = "extract_ideas" | "score_chapter";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
  ctx: { jobId: string; updateProgress: (n: number) => Promise<void> }
) => Promise<TResult>;
