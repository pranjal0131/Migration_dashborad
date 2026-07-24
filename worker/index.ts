import { db } from "../src/lib/db";
import { executeAudit } from "./audit";

const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS ?? 3000));

async function claimNextRun() {
  return db.$transaction(async (tx) => {
    const queued = await tx.migrationRun.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!queued) return null;
    const claimed = await tx.migrationRun.updateMany({ where: { id: queued.id, status: "QUEUED" }, data: { status: "CRAWLING", stageMessage: "Worker starting" } });
    return claimed.count === 1 ? queued : null;
  });
}

console.log("Migration audit worker started");
while (true) {
  const run = await claimNextRun();
  if (!run) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    continue;
  }
  try {
    console.log(`Running audit ${run.id}`);
    await executeAudit(run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    console.error(`Audit ${run.id} failed: ${message}`);
    await db.migrationRun.update({ where: { id: run.id }, data: { status: "FAILED", stageMessage: "Audit failed", errorMessage: message, completedAt: new Date() } });
  }
}
