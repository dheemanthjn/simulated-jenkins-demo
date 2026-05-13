// master/scheduler.js
const { getPendingJobs, getPendingJobsWithWaitTime, updateJobStatus, promoteJob } = require('./db');
const { getWorkerPool, assignJobToWorker } = require('./workerRegistry');
const { broadcast }                         = require('./routes/events');
const { shouldPromote }                     = require('./roleManager');
const { findPreemptionCandidate, signalPreemption } = require('./preemptionManager');

const DISPATCH_INTERVAL_MS   = 2000;
const STARVATION_INTERVAL_MS = 10000;

function selectIdleWorker(job, workers) {
  const avail = workers.filter(w => w.status === 'IDLE');
  if (!avail.length) return null;
  return avail.find(w => w.language.toLowerCase() === job.language.toLowerCase())
      || avail.find(w => w.language === 'Generic')
      || avail[0];
}

async function dispatchTick() {
  try {
    const pending  = getPendingJobs();   // PENDING + PAUSED, Q1→Q5
    const workers  = getWorkerPool();
    const idleCount = workers.filter(w => w.status === 'IDLE').length;
    if (!pending.length) return;

    console.log(`\n[SCHEDULER] ── Dispatch ── Pending: ${pending.length} | Idle: ${idleCount}`);
    pending.slice(0,5).forEach((j,i) => {
      const tag = j.status === 'PAUSED' ? '⏸PAUSED' : 'PENDING';
      const res = j.resume_from_stage > 0 ? ` (resume@${j.resume_from_stage})` : '';
      console.log(`  ${i+1}. #${j.id} [Q${j.effective_queue}] ${j.pusher_role} | ${tag}${res}`);
    });

    for (const job of pending) {
      const idleWorker = selectIdleWorker(job, workers);

      if (idleWorker) {
        // Mark busy in-memory so next loop iteration skips it
        idleWorker.status = 'BUSY';
        updateJobStatus(job.id, 'RUNNING', { worker_id: idleWorker.id });
        broadcast({ type:'JOB_STARTED', job:{ ...job, status:'RUNNING', worker_id:idleWorker.id } });
        console.log(`[SCHEDULER] ▶ Job #${job.id} [Q${job.effective_queue}] → ${idleWorker.id}`);
        assignJobToWorker(idleWorker, job);

      } else {
        // No idle worker — try preemption
        const { shouldPreempt, victim, victimJobId } = findPreemptionCandidate(job, workers);
        if (shouldPreempt && victim) {
          console.log(`[SCHEDULER] ⚡ Preemption: #${job.id} [Q${job.effective_queue}] interrupts #${victimJobId} [Q${victim.currentJobQueueLevel}] on ${victim.id}`);
          signalPreemption(victimJobId);
          broadcast({ type:'PREEMPTION_TRIGGERED', incomingJobId:job.id, victimJobId, workerId:victim.id, incomingQueue:job.effective_queue, victimQueue:victim.currentJobQueueLevel });
          // Don't assign yet — worker will finish current stage, pause, go IDLE, next tick assigns
          break;
        } else {
          console.log(`[SCHEDULER] ⏳ Job #${job.id} [Q${job.effective_queue}] — all workers busy, no preemption possible`);
          break;
        }
      }
    }
  } catch(err) { console.error('[SCHEDULER] Dispatch error:', err.message); }
}

function starvationTick() {
  try {
    const waiting = getPendingJobsWithWaitTime();
    let promoted  = 0;
    for (const job of waiting) {
      if (shouldPromote(job.effective_queue, job.seconds_waiting)) {
        const newQ    = job.effective_queue - 1;
        const updated = promoteJob(job.id, newQ);
        promoted++;
        console.log(`[STARVATION] ⬆ Job #${job.id} Q${job.effective_queue}→Q${newQ} (waited ${job.seconds_waiting}s)`);
        broadcast({ type:'JOB_PROMOTED', job:updated, oldQueue:job.effective_queue, newQueue:newQ, waitSeconds:job.seconds_waiting });
      }
    }
    if (promoted > 0) console.log(`[STARVATION] Promoted ${promoted} job(s)`);
  } catch(err) { console.error('[STARVATION] Error:', err.message); }
}

function startScheduler() {
  console.log('[SCHEDULER] Starting dispatch loop   (every 2s)');
  console.log('[SCHEDULER] Starting starvation loop (every 10s)');
  setInterval(dispatchTick,   DISPATCH_INTERVAL_MS);
  setInterval(starvationTick, STARVATION_INTERVAL_MS);
}

module.exports = { startScheduler };
