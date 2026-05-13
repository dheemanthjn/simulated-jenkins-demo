// master/db.js  —  sql.js (pure WASM, no native build required)
const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');
const { getQueueLevel } = require('./roleManager');

const DB_PATH = path.join(__dirname, '..', 'jenkins.db');
let db;

// ── Persist in-memory DB to disk after every write ────────────────────────────
function save() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ── Low-level helpers ──────────────────────────────────────────────────────────
function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  const res = db.exec('SELECT last_insert_rowid() AS id');
  const id  = res[0]?.values[0]?.[0] ?? 0;
  save();
  return Number(id);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log('[DB] Loaded existing DB from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new DB at', DB_PATH);
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      repo                TEXT    NOT NULL,
      language            TEXT    NOT NULL,
      branch              TEXT    NOT NULL,
      commit_msg          TEXT    DEFAULT '',
      pusher              TEXT    DEFAULT 'unknown',
      pusher_role         TEXT    DEFAULT 'intern',
      status              TEXT    DEFAULT 'PENDING',
      worker_id           TEXT,
      logs                TEXT    DEFAULT '',
      duration_ms         INTEGER,
      queue_level         INTEGER DEFAULT 5,
      effective_queue     INTEGER DEFAULT 5,
      promoted            INTEGER DEFAULT 0,
      promotion_count     INTEGER DEFAULT 0,
      current_stage       TEXT    DEFAULT '',
      current_stage_index INTEGER DEFAULT -1,
      completed_stages    TEXT    DEFAULT '[]',
      preempted_count     INTEGER DEFAULT 0,
      resume_from_stage   INTEGER DEFAULT 0,
      paused_at_stage     TEXT    DEFAULT '',
      created_at          TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      started_at          TEXT,
      completed_at        TEXT,
      paused_at           TEXT,
      last_promoted_at    TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS workers (
      id          TEXT    PRIMARY KEY,
      language    TEXT    NOT NULL,
      status      TEXT    DEFAULT 'IDLE',
      current_job INTEGER,
      jobs_done   INTEGER DEFAULT 0,
      jobs_failed INTEGER DEFAULT 0,
      last_seen   TEXT
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, effective_queue, created_at)`);
  save();
}

// ── Enqueue ────────────────────────────────────────────────────────────────────
function enqueueJob({ repo, language, branch, commit_msg, pusher, pusher_role }) {
  const role  = pusher_role || 'intern';
  const qLevel = getQueueLevel(role, branch);

  const newId = run(
    `INSERT INTO jobs (repo, language, branch, commit_msg, pusher, pusher_role, queue_level, effective_queue)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [repo, language, branch, commit_msg || '', pusher || 'unknown', role, qLevel, qLevel]
  );

  const job = getJob(newId);
  if (!job) throw new Error(`[DB] enqueueJob: cannot find inserted id=${newId}`);
  console.log(`[DB] Job #${job.id} queued | Q${qLevel} | ${role} | ${repo}@${branch}`);
  return job;
}

// ── Reads ──────────────────────────────────────────────────────────────────────
function getJob(id) {
  return get('SELECT * FROM jobs WHERE id = ?', [id]);
}

// PENDING + PAUSED sorted Q1→Q5. PAUSED before PENDING within same queue (resume sooner).
function getPendingJobs() {
  return all(`
    SELECT * FROM jobs
    WHERE  status IN ('PENDING','PAUSED')
    ORDER  BY effective_queue ASC,
              CASE status WHEN 'PAUSED' THEN 0 ELSE 1 END ASC,
              created_at ASC
  `);
}

function getAllJobs(limit = 50) {
  return all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', [limit]);
}

function getJobsByQueue() {
  return all(`
    SELECT effective_queue AS queue,
      COUNT(*)   AS total,
      SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status='PAUSED'  THEN 1 ELSE 0 END) AS paused
    FROM jobs
    GROUP BY effective_queue
    ORDER BY effective_queue ASC
  `);
}

function getPendingJobsWithWaitTime() {
  return all(`
    SELECT *,
      CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS seconds_waiting
    FROM  jobs
    WHERE status IN ('PENDING','PAUSED')
      AND effective_queue > 1
    ORDER BY effective_queue DESC, created_at ASC
  `);
}

// ── Status Updates ─────────────────────────────────────────────────────────────
function updateJobStatus(id, status, extras = {}) {
  const fields = ['status = ?'];
  const values = [status];

  if (status === 'RUNNING') {
    // Use COALESCE so we don't overwrite started_at on resume
    fields.push(`started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%SZ','now'))`);
    if (extras.worker_id !== undefined)         { fields.push('worker_id = ?');            values.push(extras.worker_id); }
    if (extras.current_stage !== undefined)     { fields.push('current_stage = ?');        values.push(extras.current_stage); }
    if (extras.current_stage_index !== undefined){ fields.push('current_stage_index = ?'); values.push(extras.current_stage_index); }
  }

  if (['SUCCESS','FAILURE','CANCELLED'].includes(status)) {
    fields.push(`completed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
    fields.push('current_stage = ?');         values.push('');
    fields.push('current_stage_index = ?');   values.push(-1);
    if (extras.duration_ms !== undefined)     { fields.push('duration_ms = ?');        values.push(extras.duration_ms); }
    if (extras.logs !== undefined)            { fields.push('logs = ?');              values.push(extras.logs); }
    if (extras.completed_stages !== undefined){ fields.push('completed_stages = ?');  values.push(JSON.stringify(extras.completed_stages)); }
  }

  values.push(id);
  run(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`, values);
  return getJob(id);
}

// Called when a stage starts — update what stage the job is on
function updateJobStage(id, stageName, stageIndex) {
  run('UPDATE jobs SET current_stage = ?, current_stage_index = ? WHERE id = ?',
    [stageName, stageIndex, id]);
  return getJob(id);
}

// Called when a stage completes — add it to completed_stages JSON array
function markStageComplete(id, stageName) {
  const job  = getJob(id);
  const done = JSON.parse(job.completed_stages || '[]');
  if (!done.includes(stageName)) done.push(stageName);
  run('UPDATE jobs SET completed_stages = ? WHERE id = ?', [JSON.stringify(done), id]);
}

// Called when a job is preempted — save pause state, status → PAUSED
function pauseJob(id, pausedAtStageName, resumeFromIndex, extraLogs) {
  const job   = getJob(id);
  const newLog = (job.logs || '') + '\n' + (extraLogs || '');
  run(`
    UPDATE jobs SET
      status              = 'PAUSED',
      paused_at           = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
      paused_at_stage     = ?,
      resume_from_stage   = ?,
      preempted_count     = preempted_count + 1,
      current_stage       = '',
      current_stage_index = -1,
      logs                = ?
    WHERE id = ?
  `, [pausedAtStageName, resumeFromIndex, newLog, id]);
  return getJob(id);
}

function promoteJob(jobId, newQueueLevel) {
  run(`
    UPDATE jobs SET
      effective_queue  = ?,
      promoted         = 1,
      promotion_count  = promotion_count + 1,
      last_promoted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `, [newQueueLevel, jobId]);
  return getJob(jobId);
}

function getStats() {
  return get(`
    SELECT
      COUNT(*)  AS total,
      SUM(CASE WHEN status='PENDING'  THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='RUNNING'  THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status='PAUSED'   THEN 1 ELSE 0 END) AS paused,
      SUM(CASE WHEN status='SUCCESS'  THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN status='FAILURE'  THEN 1 ELSE 0 END) AS failure,
      SUM(CASE WHEN promoted=1        THEN 1 ELSE 0 END) AS promoted_total,
      SUM(preempted_count)                                AS total_preemptions,
      AVG(CASE WHEN status='SUCCESS'  THEN duration_ms END) AS avg_duration_ms
    FROM jobs
  `);
}

// ── Workers ────────────────────────────────────────────────────────────────────
function upsertWorker({ id, language, status, current_job }) {
  run(`
    INSERT INTO workers (id, language, status, current_job, last_seen)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(id) DO UPDATE SET
      status      = excluded.status,
      current_job = excluded.current_job,
      last_seen   = excluded.last_seen
  `, [id, language, status, current_job ?? null]);
}

function markWorkerJobDone(workerId, success) {
  const col = success ? 'jobs_done' : 'jobs_failed';
  run(`UPDATE workers SET ${col} = ${col} + 1 WHERE id = ?`, [workerId]);
}

function getAllWorkers() {
  return all('SELECT * FROM workers');
}

module.exports = {
  initDB, enqueueJob, getJob,
  getPendingJobs, getAllJobs, getJobsByQueue, getPendingJobsWithWaitTime,
  updateJobStatus, updateJobStage, markStageComplete, pauseJob,
  promoteJob, getStats,
  upsertWorker, markWorkerJobDone, getAllWorkers,
};
