// scripts/demo.js
// Full terminal demonstration of the Jenkins CI/CD Simulator
// Run: node scripts/demo.js
'use strict';
const http = require('http');
const { execSync } = require('child_process');

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  cyan:   '\x1b[36m', yellow: '\x1b[33m', green:  '\x1b[32m',
  red:    '\x1b[31m', blue:   '\x1b[34m', magenta:'\x1b[35m',
  white:  '\x1b[97m', grey:   '\x1b[90m', orange: '\x1b[38;5;208m',
};
const b  = s => `${C.bold}${s}${C.reset}`;
const cy = s => `${C.cyan}${s}${C.reset}`;
const gn = s => `${C.green}${s}${C.reset}`;
const rd = s => `${C.red}${s}${C.reset}`;
const yw = s => `${C.yellow}${s}${C.reset}`;
const mg = s => `${C.magenta}${s}${C.reset}`;
const gr = s => `${C.grey}${s}${C.reset}`;
const og = s => `${C.orange}${s}${C.reset}`;

function hr(char = '─', len = 70) { return gr(char.repeat(len)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function banner(title, sub = '') {
  const line = '═'.repeat(70);
  console.log(`\n${C.cyan}${C.bold}╔${line}╗${C.reset}`);
  console.log(`${C.cyan}${C.bold}║  ${title.padEnd(68)}║${C.reset}`);
  if (sub) console.log(`${C.cyan}║  ${C.grey}${sub.padEnd(68)}${C.cyan}║${C.reset}`);
  console.log(`${C.cyan}${C.bold}╚${line}╝${C.reset}\n`);
}

function step(n, title) {
  console.log(`\n${hr()}`);
  console.log(`${b(yw(`[STEP ${n}]`))} ${b(title)}`);
  console.log(`${hr()}`);
}

function note(msg)  { console.log(`  ${cy('►')} ${msg}`); }
function ok(msg)    { console.log(`  ${gn('✓')} ${msg}`); }
function info(msg)  { console.log(`  ${gr('•')} ${gr(msg)}`); }
function warn(msg)  { console.log(`  ${yw('⚠')} ${yw(msg)}`); }
function result(msg){ console.log(`  ${mg('→')} ${b(msg)}`); }

// ── HTTP helper ───────────────────────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname:'localhost', port:3000, path, method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve({})} }); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}
function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname:'localhost', port:3000, path, method:'GET' }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve({})} });
    });
    req.on('error', reject);
    req.end();
  });
}

async function triggerJob({ pusher, pusher_role, repo, language, branch, commit_msg }) {
  const r = await post('/simulate-push', { pusher, pusher_role, repo, language, branch, commit_msg });
  return r.job;
}

async function waitForJob(id, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = await get('/api/jobs');
    const job  = (Array.isArray(jobs) ? jobs : jobs.jobs || []).find(j => j.id === id);
    if (job && ['SUCCESS','FAILURE','CANCELLED'].includes(job.status)) return job;
    await sleep(1500);
  }
  return null;
}

async function getStats() { return get('/api/jobs/meta/stats').catch(() => ({})); }
async function getJobs()  { return get('/api/jobs').catch(() => []); }

// ── DEMO ──────────────────────────────────────────────────────────────────────
async function main() {
  banner(
    'Jenkins CI/CD Simulator — Terminal Demo',
    'Role-Based Priority Queue + Preemptive Scheduling + Real GitHub Pushes'
  );

  console.log(b('ARCHITECTURE OVERVIEW'));
  console.log(hr('─', 50));
  console.log(`  ${cy('Webhook / simulate-push')} → ${yw('roleManager')} → ${mg('Priority Queue (Q1-Q5)')} → ${gn('Scheduler')} → ${og('Workers')} → ${cy('GitHub Push')}`);
  console.log();
  console.log(`  ${b('3 Real GitHub Repos:')}  api-service (Java) · frontend-app (JS) · data-pipeline (Python)`);
  console.log(`  ${b('6 Branches:')}           main, develop · main, feature/dashboard · main, experimental/ml`);
  console.log(`  ${b('4 Workers:')}            PyWorker · NodeWorker · JavaWorker · GenWorker`);
  console.log(`  ${b('5 Pipeline Stages:')}    Checkout → Install Deps → Build → Test → Deploy`);
  await sleep(1500);

  // ── STEP 1: Priority Matrix ────────────────────────────────────────────────
  step(1, 'ROLE-BASED PRIORITY MATRIX  (roleManager.js)');
  note('Every push is assigned a queue level Q1–Q5 based on WHO pushed and to WHICH branch.');
  note('Q1 = highest priority (runs first). Q5 = lowest (runs last, but never starved).\n');

  const matrix = [
    ['Role',       'main', 'develop', 'feature/*', 'testing', 'experimental/*'],
    ['admin',      'Q1',   'Q1',      'Q2',        'Q2',      'Q2'],
    ['teamlead',   'Q1',   'Q2',      'Q2',        'Q3',      'Q3'],
    ['developer',  'Q2',   'Q2',      'Q3',        'Q3',      'Q4'],
    ['employee',   'Q3',   'Q3',      'Q4',        'Q4',      'Q5'],
    ['intern',     'Q3',   'Q4',      'Q4',        'Q5',      'Q5'],
  ];

  const qColour = { Q1: C.red, Q2: C.orange, Q3: C.blue, Q4: C.green, Q5: C.grey };
  matrix.forEach((row, ri) => {
    const cells = row.map((cell, ci) => {
      const w = ci === 0 ? 12 : 15;
      const coloured = ri > 0 && ci > 0 ? `${qColour[cell] || ''}${C.bold}${cell}${C.reset}` : b(cell);
      return coloured + ' '.repeat(Math.max(0, w - cell.length));
    }).join('  ');
    if (ri === 0) console.log(`  ${C.bold}${C.white}${cells}${C.reset}`);
    else          console.log(`  ${cells}`);
  });
  await sleep(1000);

  // ── STEP 2: Health Check ───────────────────────────────────────────────────
  step(2, 'SERVER HEALTH CHECK  (GET /health)');
  try {
    const health = await get('/health');
    ok(`Server is up: ${JSON.stringify(health)}`);
    const stats = await getStats();
    ok(`Database: ${stats.total || 0} total jobs  (${stats.success||0} success, ${stats.failure||0} failed)`);
  } catch(e) {
    warn(`Server not reachable — make sure "npm run dev" is running first!`);
    process.exit(1);
  }
  await sleep(500);

  // ── STEP 3: Single Job — Admin on Main ────────────────────────────────────
  step(3, 'QUEUE A SINGLE JOB — Admin push to main  →  Q1');
  note(`POST /simulate-push  { pusher:"admin-alice", repo:"api-service", branch:"main" }`);

  const j1 = await triggerJob({
    pusher:'admin-alice', pusher_role:'admin',
    repo:'api-service', language:'Java', branch:'main',
    commit_msg:'feat: deploy rate limiter to production',
  });
  result(`Job #${j1.id} created — Queue Level: ${b(gn('Q'+j1.queue_level))} | Role: ${b(rd('admin'))} | Repo: ${b('api-service@main')}`);
  info(`queue_level=${j1.queue_level}  effective_queue=${j1.effective_queue}  status=${j1.status}`);

  console.log(`\n  ${gr('Waiting for pipeline to complete...')}`);
  const d1 = await waitForJob(j1.id, 45000);
  if (d1) {
    ok(`Job #${d1.id} → ${d1.status === 'SUCCESS' ? gn('SUCCESS') : rd('FAILURE')} in ${(d1.duration_ms/1000).toFixed(1)}s`);
    if (d1.completed_stages) {
      const stages = JSON.parse(d1.completed_stages || '[]');
      ok(`Stages completed: ${stages.map(s => gn('✓'+s)).join(' → ')}`);
    }
  }
  await sleep(500);

  // ── STEP 4: All 6 branches simultaneously ────────────────────────────────
  step(4, 'QUEUE 6 JOBS — One per repo/branch  (Priority ordering)');
  note('Queuing 6 jobs simultaneously — watch the Q1 jobs start before Q3/Q5.\n');

  const ALL_JOBS = [
    { pusher:'admin-alice',     pusher_role:'admin',     repo:'api-service',   language:'Java',       branch:'main',               commit_msg:'feat: production deploy' },
    { pusher:'teamlead-bob',    pusher_role:'teamlead',  repo:'api-service',   language:'Java',       branch:'develop',            commit_msg:'feat: integrate OAuth2' },
    { pusher:'admin-carol',     pusher_role:'admin',     repo:'frontend-app',  language:'JavaScript', branch:'main',               commit_msg:'feat: ship redesign' },
    { pusher:'developer-dave',  pusher_role:'developer', repo:'frontend-app',  language:'JavaScript', branch:'feature/dashboard',  commit_msg:'wip: charts component' },
    { pusher:'teamlead-eve',    pusher_role:'teamlead',  repo:'data-pipeline', language:'Python',     branch:'main',               commit_msg:'feat: ETL optimisation' },
    { pusher:'intern-frank',    pusher_role:'intern',    repo:'data-pipeline', language:'Python',     branch:'experimental/ml',    commit_msg:'experiment: new model' },
  ];

  const queued = [];
  for (const jd of ALL_JOBS) {
    const j = await triggerJob(jd);
    const bar = `Q${j.queue_level}`;
    const roleColor = { admin:C.red, teamlead:C.orange, developer:C.blue, employee:C.green, intern:C.grey }[jd.pusher_role] || '';
    console.log(`  ${mg('#'+String(j.id).padStart(3))} │ ${roleColor}${C.bold}${jd.pusher_role.padEnd(10)}${C.reset} │ ${b((jd.repo+'@'+jd.branch).padEnd(38))} │ ${(qColour[bar]||'')}${C.bold}${bar}${C.reset}`);
    queued.push(j.id);
    await sleep(150);
  }

  console.log(`\n  ${gr('Waiting for all 6 jobs to finish (this takes ~30s)...')}`);
  const results = [];
  for (const id of queued) {
    const done = await waitForJob(id, 90000);
    if (done) results.push(done);
  }

  console.log();
  for (const j of results) {
    const icon = j.status === 'SUCCESS' ? gn('✅ SUCCESS') : rd('❌ FAILURE');
    const prom = j.promoted      ? mg(` ⬆promoted×${j.promotion_count}`) : '';
    const prmt = j.preempted_count > 0 ? cy(` ⏸preempted×${j.preempted_count}`) : '';
    console.log(`  ${mg('#'+String(j.id).padStart(3))} │ ${icon} │ ${b(j.repo+'@'+j.branch)} │ Q${j.effective_queue} │ ${(j.duration_ms/1000).toFixed(1)}s${prom}${prmt}`);
  }
  await sleep(500);

  // ── STEP 5: Preemption demo ───────────────────────────────────────────────
  step(5, 'PREEMPTION DEMO — Q1 job interrupts running Q5 jobs');
  note('Fill all 4 workers with low-priority intern jobs (Q5).');
  note('Then immediately fire a Q1 admin job — it should preempt a Q5 job.\n');

  const preemptJobs = [];
  for (let i = 1; i <= 4; i++) {
    const j = await triggerJob({
      pusher:`intern-p${i}`, pusher_role:'intern',
      repo:'data-pipeline', language:'Python',
      branch:`experimental/ml`, commit_msg:`experiment ${i}`,
    });
    preemptJobs.push(j.id);
    process.stdout.write(`  ${gr('Queued intern job #'+j.id+'  ')}`);
    await sleep(300);
  }
  console.log('\n');
  note('All 4 workers now running Q5 intern jobs. Waiting 4s for them to pass first stage...');
  await sleep(4000);

  const adminJob = await triggerJob({
    pusher:'admin-emergency', pusher_role:'admin',
    repo:'api-service', language:'Java', branch:'main',
    commit_msg:'URGENT: hotfix security vulnerability',
  });
  console.log();
  result(`Admin Q1 job #${adminJob.id} fired! Preemption should trigger within ~3s.`);
  info('Watch the server terminal for: [PREEMPT] 🚩 Flag set on Job #...');
  info('A Q5 job will pause after its current stage, freeing a worker for Q1.\n');

  await sleep(6000);
  const adminDone = await waitForJob(adminJob.id, 60000);
  if (adminDone) {
    ok(`Admin job #${adminDone.id} → ${adminDone.status === 'SUCCESS' ? gn('SUCCESS') : rd('FAILURE')} in ${(adminDone.duration_ms/1000).toFixed(1)}s`);
  }

  // ── STEP 6: Stats summary ─────────────────────────────────────────────────
  step(6, 'FINAL STATS  (GET /api/jobs/meta/stats)');
  const stats = await getStats();
  const statRows = [
    ['Total jobs run',    stats.total            || 0],
    ['Success',          stats.success          || 0],
    ['Failure',          stats.failure          || 0],
    ['Paused (PAUSED)',  stats.paused           || 0],
    ['Promoted (anti-starvation)', stats.promoted_total || 0],
    ['Total preemptions',stats.total_preemptions|| 0],
    ['Avg build time',   stats.avg_duration_ms  ? (stats.avg_duration_ms/1000).toFixed(1)+'s' : 'N/A'],
  ];
  statRows.forEach(([k,v]) => console.log(`  ${b(k.padEnd(32))} ${gn(String(v))}`));

  // ── STEP 7: GitHub ────────────────────────────────────────────────────────
  step(7, 'GITHUB REPOS — Live commits pushed after every build');
  console.log(`  ${b('Repo')}                ${b('Branch')}               ${b('URL')}`);
  console.log(hr('─', 70));
  [
    ['api-service',   'main, develop',       'github.com/dheemanthjn/api-service'],
    ['frontend-app',  'main, feature/dash',  'github.com/dheemanthjn/frontend-app'],
    ['data-pipeline', 'main, experimental',  'github.com/dheemanthjn/data-pipeline'],
  ].forEach(([r,b2,u]) => console.log(`  ${gn(r.padEnd(18))} ${yw(b2.padEnd(22))} ${cy(u)}`));
  console.log();
  note('After each build, the CI pushes a build-report.json commit to the matching branch.');
  note('Check GitHub to see real commits like: "ci(api-service/main): ✅ Job #5 SUCCESS | Q1 | 14.2s"');

  // ── STEP 8: API reference ─────────────────────────────────────────────────
  step(8, 'API ENDPOINTS — Full curl reference');
  const apis = [
    ['GET',  '/api/jobs',                    'List all jobs (latest 50)'],
    ['GET',  '/api/jobs/:id',                'Get one job by ID'],
    ['GET',  '/api/jobs/by-queue/1',         'All jobs in Q1'],
    ['GET',  '/api/jobs/by-queue/5',         'All jobs in Q5 (intern)'],
    ['GET',  '/api/jobs/meta/queues',        'Job count per queue level'],
    ['GET',  '/api/jobs/meta/stats',         'Aggregate stats (totals, avg time, preemptions)'],
    ['GET',  '/api/jobs/meta/workers',       'All worker status'],
    ['POST', '/simulate-push',               'Trigger a job (no webhook sig needed)'],
    ['GET',  '/events',                      'Server-Sent Events stream (real-time)'],
    ['GET',  '/health',                      'Server health check'],
  ];
  apis.forEach(([method, path2, desc]) => {
    const mCol = method === 'GET' ? gn(method.padEnd(5)) : yw(method.padEnd(5));
    console.log(`  ${mCol} ${cy(('http://localhost:3000'+path2).padEnd(45))} ${gr(desc)}`);
  });

  console.log();
  note(`Try it: ${cy('curl http://localhost:3000/api/jobs/meta/stats | python -m json.tool')}`);
  note(`Or:     ${cy('curl http://localhost:3000/api/jobs | python -m json.tool')}`);

  // ── DONE ──────────────────────────────────────────────────────────────────
  banner(
    '✅ Demo Complete',
    'All features demonstrated: Priority Queue · Preemption · Stage Tracking · GitHub Commits'
  );
  console.log(`  ${b('Dashboard (visual):')} ${cy('http://localhost:3000/dashboard.html')}`);
  console.log(`  ${b('API base:')}           ${cy('http://localhost:3000/api/jobs')}`);
  console.log(`  ${b('GitHub repos:')}`);
  console.log(`    ${cy('https://github.com/dheemanthjn/api-service')}`);
  console.log(`    ${cy('https://github.com/dheemanthjn/frontend-app')}`);
  console.log(`    ${cy('https://github.com/dheemanthjn/data-pipeline')}`);
  console.log();
}

main().catch(err => {
  console.error(rd(`\n❌ Demo failed: ${err.message}`));
  console.error(gr('   Make sure the server is running:  npm run dev'));
  process.exit(1);
});
