// master/workerRegistry.js
const {
  updateJobStatus, updateJobStage,
  markStageComplete, pauseJob,
  upsertWorker, markWorkerJobDone,
} = require('./db');
const { broadcast }                    = require('./routes/events');
const { isPreempted, clearPreemption } = require('./preemptionManager');
const { pushBuildResult }              = require('./gitPush');

const WORKER_DEFINITIONS = [
  { id:'worker-1', language:'Python',     name:'PyWorker'   },
  { id:'worker-2', language:'JavaScript', name:'NodeWorker' },
  { id:'worker-3', language:'Java',       name:'JavaWorker' },
  { id:'worker-4', language:'Generic',    name:'GenWorker'  },
];
const workerPool = new Map();

function initWorkers() {
  for (const def of WORKER_DEFINITIONS) {
    const w = { ...def, status:'IDLE', currentJobId:null, currentJobQueueLevel:null, jobsDone:0, jobsFailed:0 };
    workerPool.set(def.id, w);
    upsertWorker({ id:def.id, language:def.language, status:'IDLE', current_job:null });
    console.log(`[WORKER] Initialized ${def.name} (${def.language})`);
  }
}
function getWorkerPool() { return Array.from(workerPool.values()); }

const PIPELINE_STAGES = [
  { name:'Checkout',    index:0, minMs:800,  maxMs:2000, failRate:0.02 },
  { name:'Install Deps',index:1, minMs:1500, maxMs:4000, failRate:0.05 },
  { name:'Build',       index:2, minMs:2000, maxMs:5000, failRate:0.08 },
  { name:'Test',        index:3, minMs:2000, maxMs:5000, failRate:0.10 },
  { name:'Deploy',      index:4, minMs:800,  maxMs:2000, failRate:0.03 },
];

function rnd(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

async function executeStage(stage) {
  const ms = rnd(stage.minMs, stage.maxMs);
  await new Promise(r => setTimeout(r, ms));
  if (Math.random() < stage.failRate) throw new Error(`"${stage.name}" failed (simulated)`);
  return ms;
}

async function executeJob(worker, job) {
  const logs = [], t0 = Date.now(), start = job.resume_from_stage || 0;
  const completedStages = JSON.parse(job.completed_stages || '[]');
  const resumeNote = start > 0 ? ` (RESUMING from ${PIPELINE_STAGES[start]?.name})` : '';
  logs.push(`[${new Date().toISOString()}] Job #${job.id} on ${worker.name}${resumeNote}`);
  logs.push(`[INFO] ${job.repo}@${job.branch} | Q${job.effective_queue} | ${job.pusher_role}`);
  if (job.preempted_count > 0) logs.push(`[INFO] Preempted ${job.preempted_count}× — resuming`);
  logs.push('─'.repeat(50));
  await new Promise(r => setTimeout(r, rnd(100,400)));

  for (let i = start; i < PIPELINE_STAGES.length; i++) {
    const stage = PIPELINE_STAGES[i];

    // ── Preemption check before each stage ───────────────────────────────────
    if (isPreempted(job.id)) {
      logs.push(`[PREEMPTED] Pausing before "${stage.name}"`);
      console.log(`[WORKER] ${worker.name}: preempted job #${job.id} before ${stage.name}`);
      const saved = pauseJob(job.id, stage.name, i, logs.join('\n'));
      clearPreemption(job.id);
      broadcast({ type:'JOB_PREEMPTED', job:saved, pausedAtStage:stage.name, pausedAtIndex:i, completedStages });
      return { preempted:true, completedStages };
    }

    logs.push(`[STAGE ${i+1}/5] ▶ ${stage.name}...`);
    updateJobStage(job.id, stage.name, i);
    broadcast({ type:'STAGE_STARTED', jobId:job.id, workerId:worker.id, stage:stage.name, stageIndex:i, totalStages:5 });

    try {
      const ms = await executeStage(stage);
      completedStages.push(stage.name);
      markStageComplete(job.id, stage.name);
      logs.push(`[STAGE ${i+1}/5] ✅ ${stage.name} — ${ms}ms`);
      broadcast({ type:'STAGE_COMPLETED', jobId:job.id, workerId:worker.id, stage:stage.name, stageIndex:i, duration:ms, status:'ok', completedStages:[...completedStages], totalStages:5 });
    } catch(err) {
      logs.push(`[STAGE ${i+1}/5] ❌ ${stage.name} — ${err.message}`);
      broadcast({ type:'STAGE_COMPLETED', jobId:job.id, workerId:worker.id, stage:stage.name, stageIndex:i, status:'failed' });
      return { preempted:false, success:false, logs:logs.join('\n'), duration:Date.now()-t0, completedStages };
    }
  }

  const dur = Date.now()-t0;
  logs.push('─'.repeat(50));
  logs.push(`✅ Job #${job.id} SUCCESS — ${dur}ms`);
  return { preempted:false, success:true, logs:logs.join('\n'), duration:dur, completedStages };
}

async function assignJobToWorker(workerDef, job) {
  const worker = workerPool.get(workerDef.id);
  if (!worker) return;
  worker.status='BUSY'; worker.currentJobId=job.id; worker.currentJobQueueLevel=job.effective_queue;
  upsertWorker({ id:worker.id, language:worker.language, status:'BUSY', current_job:job.id });
  broadcast({ type:'WORKER_BUSY', workerId:worker.id, jobId:job.id });
  const action = job.resume_from_stage > 0 ? 'RESUMING' : 'STARTING';
  console.log(`[WORKER] ${worker.name} ${action} job #${job.id} [Q${job.effective_queue}] ${job.repo}@${job.branch}`);
  if (job.resume_from_stage > 0) {
    broadcast({ type:'JOB_RESUMED', job, resumingFromStage:PIPELINE_STAGES[job.resume_from_stage]?.name, resumingFromIndex:job.resume_from_stage });
  }
  try {
    const result = await executeJob(worker, job);
    if (result.preempted) {
      console.log(`[WORKER] ${worker.name} freed (preempted job #${job.id})`);
    } else {
      const st = result.success ? 'SUCCESS' : 'FAILURE';
      const finalJob = updateJobStatus(job.id, st, { logs:result.logs, duration_ms:result.duration, completed_stages:result.completedStages });
      markWorkerJobDone(worker.id, result.success);
      console.log(`[WORKER] ${worker.name} finished job #${job.id}: ${st} in ${result.duration}ms`);
      broadcast({ type:'JOB_COMPLETED', job:{ ...job, status:st, duration_ms:result.duration, worker_id:worker.id, completed_stages:JSON.stringify(result.completedStages) } });
      // Push build result commit to the matching GitHub branch (non-blocking)
      pushBuildResult({ ...job, ...finalJob, status:st, duration_ms:result.duration, completed_stages:JSON.stringify(result.completedStages) });
    }
  } catch(err) {
    console.error(`[WORKER] ${worker.name} fatal error job #${job.id}:`, err.message);
    updateJobStatus(job.id, 'FAILURE', { logs:'Fatal: '+err.message });
    broadcast({ type:'JOB_COMPLETED', job:{ ...job, status:'FAILURE', worker_id:worker.id } });
  } finally {
    worker.status='IDLE'; worker.currentJobId=null; worker.currentJobQueueLevel=null;
    upsertWorker({ id:worker.id, language:worker.language, status:'IDLE', current_job:null });
    broadcast({ type:'WORKER_IDLE', workerId:worker.id });
    console.log(`[WORKER] ${worker.name} is now IDLE`);
  }
}

module.exports = { initWorkers, getWorkerPool, assignJobToWorker };
