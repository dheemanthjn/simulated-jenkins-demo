// scripts/simulate-all-repos.js
// Fires 11 push scenarios covering every role and branch type combination.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const http   = require('http');

const MASTER_URL     = process.env.MASTER_URL     || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mysecret';

const SCENARIOS = [
  // api-service
  { pusher:'admin-alice',     role:'admin',     repo:'api-service',    language:'Java',       branch:'main',                   files:['Main.java'],                messages:['feat: deploy new rate limiter to production','fix: patch critical null pointer in auth'] },
  { pusher:'teamlead-bob',    role:'teamlead',  repo:'api-service',    language:'Java',       branch:'develop',                files:['src/PaymentService.java'],   messages:['feat: integrate payment gateway','refactor: clean up service layer'] },
  { pusher:'developer-carol', role:'developer', repo:'api-service',    language:'Java',       branch:'feature/user-profile',   files:['src/UserProfile.java'],      messages:['feat: add user profile endpoint','fix: validate user input'] },
  { pusher:'developer-dave',  role:'developer', repo:'api-service',    language:'Java',       branch:'hotfix/auth-crash',      files:['src/AuthService.java'],      messages:['hotfix: fix session expiry crash','hotfix: patch token validation bug'] },
  // frontend-app
  { pusher:'teamlead-eve',    role:'teamlead',  repo:'frontend-app',   language:'JavaScript', branch:'main',                   files:['index.js'],                  messages:['feat: deploy redesigned homepage','fix: resolve mobile layout issue'] },
  { pusher:'developer-frank', role:'developer', repo:'frontend-app',   language:'JavaScript', branch:'feature/new-dashboard',  files:['src/Dashboard.js'],          messages:['feat: build new analytics dashboard','wip: dashboard charts in progress'] },
  { pusher:'employee-grace',  role:'employee',  repo:'frontend-app',   language:'JavaScript', branch:'testing',                files:['tests/ui.test.js'],          messages:['test: add e2e tests for checkout flow','test: increase coverage'] },
  // data-pipeline
  { pusher:'admin-henry',     role:'admin',     repo:'data-pipeline',  language:'Python',     branch:'main',                   files:['pipeline.py'],               messages:['feat: optimised ETL pipeline live','fix: handle missing values in transform'] },
  { pusher:'developer-iris',  role:'developer', repo:'data-pipeline',  language:'Python',     branch:'feature/ml-model',       files:['models/classifier.py'],      messages:['feat: add random forest classifier','refactor: improve model accuracy'] },
  { pusher:'intern-jack',     role:'intern',    repo:'data-pipeline',  language:'Python',     branch:'experimental/new-algorithm', files:['experiments/algo_v2.py'],messages:['wip: experimenting with new algorithm','test: trying different approach'] },
  { pusher:'intern-kate',     role:'intern',    repo:'frontend-app',   language:'JavaScript', branch:'experimental/dark-mode', files:['src/themes/dark.js'],        messages:['wip: attempting dark mode','experiment: testing colour palette'] },
];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function simulatePush(s) {
  const commitMsg = randomFrom(s.messages);
  const payload = {
    ref:        `refs/heads/${s.branch}`,
    repository: { name: s.repo, language: s.language, full_name: `demo-org/${s.repo}` },
    pusher:     { name: s.pusher },
    head_commit: {
      id:        Math.random().toString(36).substring(2, 10),
      message:   commitMsg,
      timestamp: new Date().toISOString(),
      added:     [s.files[0]],
      modified:  s.files.slice(1),
      removed:   [],
    },
  };

  const body = JSON.stringify(payload);
  const sig  = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const url  = new URL(`${MASTER_URL}/webhook`);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'X-GitHub-Event': 'push', 'X-Hub-Signature-256': sig,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          console.log(`[SIM] Job #${p.job_id} | ${s.pusher} (${s.role}) → ${s.repo}@${s.branch} | Q${p.queue_level} | "${commitMsg}"`);
          resolve(p);
        } catch { console.error('[SIM] Bad response:', data.slice(0, 200)); resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function runAll() {
  console.log('\n🚀 Simulating role-based pushes\n' + '═'.repeat(60));
  console.log('admin+main=Q1 | teamlead+develop=Q2 | developer+feature=Q3');
  console.log('employee+testing=Q4 | intern+experimental=Q5');
  console.log('═'.repeat(60) + '\n');

  // Shuffle so jobs don't arrive in neat priority order (realistic)
  const shuffled = [...SCENARIOS].sort(() => Math.random() - 0.5);
  for (const s of shuffled) {
    await simulatePush(s);
    await new Promise(r => setTimeout(r, 300 + Math.floor(Math.random() * 1200)));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ All scenarios sent! Watch http://localhost:3000/dashboard.html');
  console.log('Q1 jobs run first. Q5 jobs run last (promoted after 2 min if starved).\n');
}

runAll().catch(console.error);
