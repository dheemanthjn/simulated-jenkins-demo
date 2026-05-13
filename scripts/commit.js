#!/usr/bin/env node
// scripts/commit.js
// Make a real git commit to one of the 3 repos, then fire the CI job with correct priority.
//
// Usage:
//   node scripts/commit.js --role admin      --repo api-service   --branch main              --msg "deploy rate limiter"
//   node scripts/commit.js --role teamlead   --repo api-service   --branch develop           --msg "integrate OAuth2"
//   node scripts/commit.js --role developer  --repo frontend-app  --branch feature/dashboard --msg "add chart component"
//   node scripts/commit.js --role employee   --repo frontend-app  --branch main              --msg "fix typo in header"
//   node scripts/commit.js --role intern     --repo data-pipeline --branch experimental/ml   --msg "try new model"
//
// Shortcuts (--preset):
//   node scripts/commit.js --preset admin-prod
//   node scripts/commit.js --preset intern-exp
//   node scripts/commit.js --preset all        ← fires one commit per role/branch combo

'use strict';
const { execSync } = require('child_process');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Colour helpers ────────────────────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m',
  cyan:'\x1b[36m', green:'\x1b[32m', red:'\x1b[31m',
  yellow:'\x1b[33m', magenta:'\x1b[35m', grey:'\x1b[90m',
  orange:'\x1b[38;5;208m',
};
const b  = s => `${C.bold}${s}${C.reset}`;
const cy = s => `${C.cyan}${s}${C.reset}`;
const gn = s => `${C.green}${s}${C.reset}`;
const rd = s => `${C.red}${s}${C.reset}`;
const yw = s => `${C.yellow}${s}${C.reset}`;
const mg = s => `${C.magenta}${s}${C.reset}`;
const gr = s => `${C.grey}${s}${C.reset}`;

// ── Config ────────────────────────────────────────────────────────────────────
const GITHUB_USER = 'dheemanthjn';
const REPOS = {
  'api-service':   { language: 'Java',       url: `https://github.com/${GITHUB_USER}/api-service.git`   },
  'frontend-app':  { language: 'JavaScript', url: `https://github.com/${GITHUB_USER}/frontend-app.git`  },
  'data-pipeline': { language: 'Python',     url: `https://github.com/${GITHUB_USER}/data-pipeline.git` },
};

const ROLE_PUSHER = {
  admin:     'admin-alice',
  teamlead:  'teamlead-bob',
  developer: 'developer-carol',
  employee:  'employee-dave',
  intern:    'intern-eve',
};

const ROLE_COLOUR = {
  admin: C.red, teamlead: C.orange, developer: C.cyan,
  employee: C.green, intern: C.grey,
};

// Presets: common role+repo+branch combos for quick demo
const PRESETS = {
  'admin-prod':    { role:'admin',     repo:'api-service',   branch:'main',               msg:'feat: deploy rate limiter to production' },
  'admin-fe':      { role:'admin',     repo:'frontend-app',  branch:'main',               msg:'feat: ship redesigned homepage' },
  'teamlead-int':  { role:'teamlead',  repo:'api-service',   branch:'develop',            msg:'feat: integrate OAuth2 flow' },
  'teamlead-data': { role:'teamlead',  repo:'data-pipeline', branch:'main',               msg:'feat: optimise ETL pipeline' },
  'dev-feat':      { role:'developer', repo:'frontend-app',  branch:'feature/dashboard',  msg:'wip: add analytics chart component' },
  'dev-api':       { role:'developer', repo:'api-service',   branch:'develop',            msg:'fix: validate user input on login' },
  'employee-test': { role:'employee',  repo:'frontend-app',  branch:'main',               msg:'test: increase unit test coverage' },
  'intern-exp':    { role:'intern',    repo:'data-pipeline', branch:'experimental/ml',    msg:'experiment: test new ML model parameters' },
  'all': 'all',
};

const ALL_COMMITS = [
  { role:'admin',     repo:'api-service',   branch:'main',              msg:'feat: production security patch'     },
  { role:'teamlead',  repo:'api-service',   branch:'develop',           msg:'feat: integrate payment gateway'     },
  { role:'admin',     repo:'frontend-app',  branch:'main',              msg:'feat: deploy new homepage redesign'  },
  { role:'developer', repo:'frontend-app',  branch:'feature/dashboard', msg:'wip: analytics chart component'      },
  { role:'teamlead',  repo:'data-pipeline', branch:'main',              msg:'feat: optimise ETL throughput'       },
  { role:'intern',    repo:'data-pipeline', branch:'experimental/ml',   msg:'experiment: test transformer model'  },
];

// ── Priority Matrix (mirrors roleManager.js) ──────────────────────────────────
function getQueueLevel(role, branch) {
  const matrix = {
    admin:     { main:1, develop:1, feature:2, testing:2, experimental:2, hotfix:1, release:1 },
    teamlead:  { main:1, develop:2, feature:2, testing:3, experimental:3, hotfix:1, release:2 },
    developer: { main:2, develop:2, feature:3, testing:3, experimental:4, hotfix:2, release:2 },
    employee:  { main:3, develop:3, feature:4, testing:4, experimental:5, hotfix:3, release:3 },
    intern:    { main:3, develop:4, feature:4, testing:5, experimental:5, hotfix:3, release:4 },
  };
  const btype =
    branch === 'main'               ? 'main'         :
    branch === 'develop'            ? 'develop'       :
    branch.startsWith('feature/')   ? 'feature'       :
    branch.startsWith('hotfix/')    ? 'hotfix'        :
    branch.startsWith('release/')   ? 'release'       :
    branch.startsWith('experimental')? 'experimental' :
    branch.startsWith('testing')    ? 'testing'       : 'feature';
  return (matrix[role] || matrix.intern)[btype] || 5;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function triggerCI({ repo, branch, role, msg }) {
  return new Promise((resolve, reject) => {
    const pusher = ROLE_PUSHER[role] || `${role}-user`;
    const lang   = REPOS[repo]?.language || 'Generic';
    const body   = JSON.stringify({ repo, language:lang, branch, commit_msg:msg, pusher, pusher_role:role });
    const req    = http.request({
      hostname:'localhost', port:3000, path:'/simulate-push', method:'POST',
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve({})} }); });
    req.on('error', err => { reject(new Error('Server not reachable. Is npm run dev running?')); });
    req.write(body); req.end();
  });
}

// ── Git commit & push ──────────────────────────────────────────────────────────
function gitCommitAndPush({ repo, branch, role, msg }) {
  const repoInfo = REPOS[repo];
  if (!repoInfo) throw new Error(`Unknown repo: ${repo}`);

  // Use a persistent local clone in ../jenkins-clones/{repo}
  const cloneBase = path.join(__dirname, '..', '..', 'jenkins-clones');
  const cloneDir  = path.join(cloneBase, repo);
  fs.mkdirSync(cloneBase, { recursive: true });

  const git = (cmd) => execSync(`git ${cmd}`, { cwd: cloneDir, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });

  // Clone once, then reuse
  if (!fs.existsSync(path.join(cloneDir, '.git'))) {
    console.log(`  ${gr('Cloning')} ${cy(repo)} ${gr('(first time only)...')}`);
    execSync(`git clone ${repoInfo.url} "${cloneDir}"`, { encoding:'utf8', stdio:['pipe','pipe','pipe'] });
  }

  // Fetch latest
  try { git('fetch origin --quiet'); } catch {}

  // Checkout the target branch
  const remoteBranches = git('branch -r').split('\n').map(s => s.trim());
  const exists = remoteBranches.includes(`origin/${branch}`);

  if (exists) {
    try { git(`checkout ${branch}`); } catch { git(`checkout -b ${branch} origin/${branch}`); }
    try { git(`pull origin ${branch} --quiet`); } catch {}
  } else {
    git(`checkout -b ${branch}`);
  }

  // Configure git identity using the role
  git(`config user.name "${ROLE_PUSHER[role] || role}"`);
  git(`config user.email "${role}@jenkins-simulator.local"`);

  // Write a change — update a timestamped changes.log file
  const timestamp = new Date().toISOString();
  const logFile   = path.join(cloneDir, 'changes.log');
  const logLine   = `[${timestamp}] [${role.toUpperCase()}] ${msg}\n`;
  fs.appendFileSync(logFile, logLine, 'utf8');

  // Stage and commit
  git('add changes.log');
  const commitMsg = `${role}(${branch}): ${msg}`;
  git(`commit -m "${commitMsg}"`);

  // Push
  try {
    git(`push origin ${branch}`);
  } catch {
    git(`push -u origin ${branch}`);
  }

  return commitMsg;
}

// ── Print usage ───────────────────────────────────────────────────────────────
function printUsage() {
  console.log(`\n${b('USAGE')}`);
  console.log('  node scripts/commit.js [options]\n');
  console.log(`${b('OPTIONS')}`);
  console.log('  --role    <role>    admin | teamlead | developer | employee | intern');
  console.log('  --repo    <repo>    api-service | frontend-app | data-pipeline');
  console.log('  --branch  <branch>  e.g. main, develop, feature/dashboard, experimental/ml');
  console.log('  --msg     <text>    Commit message');
  console.log('  --preset  <name>    Use a preset (see below)');
  console.log('  --git-only          Only commit to GitHub, skip CI trigger');
  console.log('  --ci-only           Only trigger CI, skip git commit');
  console.log(`\n${b('PRESETS')}`);
  Object.entries(PRESETS).filter(([k]) => k !== 'all').forEach(([k, v]) => {
    if (typeof v === 'object') {
      const q = getQueueLevel(v.role, v.branch);
      console.log(`  ${yw('--preset '+k.padEnd(15))} ${(ROLE_COLOUR[v.role]||'')}${v.role.padEnd(11)}${C.reset} ${cy((v.repo+'@'+v.branch).padEnd(35))} ${mg('→ Q'+q)}`);
    }
  });
  console.log(`  ${yw('--preset all      ')} Runs all 6 combos in priority order\n`);
  console.log(`${b('EXAMPLES')}`);
  console.log(`  ${gr('node scripts/commit.js --preset admin-prod')}`);
  console.log(`  ${gr('node scripts/commit.js --preset all')}`);
  console.log(`  ${gr('node scripts/commit.js --role developer --repo frontend-app --branch feature/dashboard --msg "add dark mode"')}\n`);
}

// ── Run one commit ────────────────────────────────────────────────────────────
async function runCommit({ role, repo, branch, msg, gitOnly, ciOnly }) {
  const q      = getQueueLevel(role, branch);
  const qCol   = [C.red,C.orange,C.cyan,C.green,C.grey][q-1] || '';
  const rCol   = ROLE_COLOUR[role] || '';

  console.log(`\n  ${b('Role')}     ${rCol}${C.bold}${role}${C.reset}`);
  console.log(`  ${b('Repo')}     ${cy(repo)}`);
  console.log(`  ${b('Branch')}   ${yw(branch)}`);
  console.log(`  ${b('Message')}  "${msg}"`);
  console.log(`  ${b('Priority')} ${qCol}${C.bold}Q${q}${C.reset} ${gr('('+role+' on '+branch+')')}`);
  console.log();

  // ── Step 1: Git commit ──────────────────────────────────────────────────
  if (!ciOnly) {
    process.stdout.write(`  ${gr('1.')} Git commit + push... `);
    try {
      const commitMsg = gitCommitAndPush({ repo, branch, role, msg });
      console.log(gn('✓'));
      console.log(`     ${gr('Committed:')} "${commitMsg}"`);
      console.log(`     ${gr('View:')} ${cy(`https://github.com/${GITHUB_USER}/${repo}/commits/${branch}`)}`);
    } catch(e) {
      console.log(yw('⚠ skipped'));
      console.log(`     ${gr(e.message.split('\n')[0])}`);
    }
  }

  // ── Step 2: Trigger CI ──────────────────────────────────────────────────
  if (!gitOnly) {
    process.stdout.write(`  ${gr('2.')} Trigger CI pipeline... `);
    try {
      const result = await triggerCI({ repo, branch, role, msg });
      const job    = result.job;
      console.log(gn('✓'));
      if (job) {
        console.log(`     ${gr('Job')} ${b('#'+job.id)} ${gr('queued at')} ${qCol}${C.bold}Q${job.queue_level}${C.reset} ${gr('| status:')} ${yw(job.status)}`);
        console.log(`     ${gr('Watch:')} ${cy('http://localhost:3000/dashboard.html')}`);
        console.log(`     ${gr('API:')}   ${cy('curl http://localhost:3000/api/jobs/'+job.id)}`);
      }
    } catch(e) {
      console.log(rd('✗'));
      console.log(`     ${rd(e.message)}`);
    }
  }
}

// ── Parse args ────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`\n${C.cyan}${C.bold}Jenkins CI/CD Simulator — Role-Based Commit Tool${C.reset}`);
    printUsage();
    return;
  }

  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i+1] : null; };
  const has = (flag) => args.includes(flag);

  const preset  = get('--preset');
  const gitOnly = has('--git-only');
  const ciOnly  = has('--ci-only');

  // ── Preset mode ────────────────────────────────────────────────────────
  if (preset) {
    if (preset === 'all') {
      console.log(`\n${C.bold}${C.cyan}Running all 6 role/branch combinations...${C.reset}`);
      console.log(C.grey + '─'.repeat(60) + C.reset);
      for (const c of ALL_COMMITS) {
        await runCommit({ ...c, gitOnly, ciOnly });
        await new Promise(r => setTimeout(r, 400));
      }
      console.log(`\n${gn('✅ All 6 commits done!')}`);
      return;
    }

    const p = PRESETS[preset];
    if (!p) {
      console.error(rd(`Unknown preset "${preset}". Valid: ${Object.keys(PRESETS).join(', ')}`));
      process.exit(1);
    }
    console.log(`\n${C.bold}${C.cyan}Jenkins CI — Role-Based Commit${C.reset}  ${C.grey}[preset: ${preset}]${C.reset}`);
    console.log(C.grey + '─'.repeat(60) + C.reset);
    await runCommit({ ...p, gitOnly, ciOnly });
    return;
  }

  // ── Manual mode ────────────────────────────────────────────────────────
  const role   = get('--role');
  const repo   = get('--repo');
  const branch = get('--branch');
  const msg    = get('--msg') || `${role}: update ${branch}`;

  if (!role || !repo || !branch) {
    console.error(rd('Missing required flags: --role, --repo, --branch'));
    printUsage();
    process.exit(1);
  }
  if (!ROLE_PUSHER[role]) {
    console.error(rd(`Unknown role "${role}". Valid: admin, teamlead, developer, employee, intern`));
    process.exit(1);
  }
  if (!REPOS[repo]) {
    console.error(rd(`Unknown repo "${repo}". Valid: api-service, frontend-app, data-pipeline`));
    process.exit(1);
  }

  console.log(`\n${C.bold}${C.cyan}Jenkins CI — Role-Based Commit${C.reset}`);
  console.log(C.grey + '─'.repeat(60) + C.reset);
  await runCommit({ role, repo, branch, msg, gitOnly, ciOnly });
}

main().catch(err => {
  console.error(rd('\n❌ ' + err.message));
  process.exit(1);
});
