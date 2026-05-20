export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { recoverOrphans } = await import("./lib/jobs");
    const n = await recoverOrphans();
    if (n > 0) {
      // eslint-disable-next-line no-console
      console.log(`[jobs] recovered ${n} orphaned running job(s) as failed`);
    }
  }
}
