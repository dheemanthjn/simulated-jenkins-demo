// master/preemptionManager.js
// In-memory bulletin board for preemption signals.
// Workers check this between every stage. No DB needed — O(1) Set lookup.

const preemptionFlags = new Set();

// Scheduler calls this when a higher-priority job needs a worker
function signalPreemption(jobId) {
  preemptionFlags.add(jobId);
  console.log(`[PREEMPT] 🚩 Flag set on Job #${jobId} — will pause after current stage`);
}

// Clear after worker acknowledges and pauses
function clearPreemption(jobId) {
  preemptionFlags.delete(jobId);
}

// Worker calls this at every stage boundary
function isPreempted(jobId) {
  return preemptionFlags.has(jobId);
}

// ── Should we preempt? ────────────────────────────────────────────────────────
// Returns { shouldPreempt, victim, victimJobId } or { shouldPreempt: false }
// newJob:      the high-priority job that just arrived and has no idle worker
// workerPool:  all worker objects with { status, currentJobId, currentJobQueueLevel }
function findPreemptionCandidate(newJob, workerPool) {
  const busyWorkers = workerPool.filter(w => w.status === 'BUSY' && w.currentJobId);
  if (busyWorkers.length === 0) return { shouldPreempt: false };

  // Find the busy worker running the LOWEST-priority job (biggest queue number)
  // that is strictly lower priority than newJob
  let worstWorker     = null;
  let worstQueueLevel = 0;

  for (const w of busyWorkers) {
    const runningQ = w.currentJobQueueLevel || 5;
    // Only preempt if running job is strictly lower priority (higher number)
    if (runningQ > newJob.effective_queue && runningQ > worstQueueLevel) {
      worstQueueLevel = runningQ;
      worstWorker     = w;
    }
  }

  if (!worstWorker) return { shouldPreempt: false };

  console.log(
    `[PREEMPT] Decision: Job #${newJob.id} [Q${newJob.effective_queue}]` +
    ` will preempt Job #${worstWorker.currentJobId} [Q${worstQueueLevel}] on ${worstWorker.id}`
  );

  return { shouldPreempt: true, victim: worstWorker, victimJobId: worstWorker.currentJobId };
}

module.exports = { signalPreemption, clearPreemption, isPreempted, findPreemptionCandidate };
