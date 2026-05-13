// scripts/trigger-all-branches.js
// Fires one CI job per branch (6 total), demonstrating all 3 repos × 2 branches
const http = require('http');

const JOBS = [
  // api-service
  { repo:'api-service',   language:'Java',       branch:'main',                pusher:'admin-alice',    pusher_role:'admin',     commit_msg:'feat: deploy rate limiter to production' },
  { repo:'api-service',   language:'Java',       branch:'develop',             pusher:'teamlead-bob',   pusher_role:'teamlead',  commit_msg:'feat: integrate OAuth2 flow' },
  // frontend-app
  { repo:'frontend-app',  language:'JavaScript', branch:'main',                pusher:'admin-alice',    pusher_role:'admin',     commit_msg:'feat: ship redesigned homepage' },
  { repo:'frontend-app',  language:'JavaScript', branch:'feature/dashboard',   pusher:'developer-carol',pusher_role:'developer', commit_msg:'wip: add analytics charts' },
  // data-pipeline
  { repo:'data-pipeline', language:'Python',     branch:'main',                pusher:'teamlead-eve',   pusher_role:'teamlead',  commit_msg:'feat: optimize ETL performance' },
  { repo:'data-pipeline', language:'Python',     branch:'experimental/ml',     pusher:'intern-frank',   pusher_role:'intern',    commit_msg:'experiment: test new ML model' },
];

function post(body) {
  return new Promise((res, rej) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000,
      path: '/simulate-push', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => res(JSON.parse(d)));
    });
    req.on('error', rej);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('🚀 Triggering CI jobs for all 6 branches\n');
  console.log('Repo              Branch                    Role       Queue');
  console.log('─'.repeat(65));

  for (const job of JOBS) {
    const result = await post(job);
    const j = result.job;
    const repo   = job.repo.padEnd(16);
    const branch = job.branch.padEnd(25);
    const role   = job.pusher_role.padEnd(10);
    console.log(`${repo} ${branch} ${role} → Q${j.queue_level} (Job #${j.id})`);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n✅ All 6 jobs queued! Watch the dashboard: http://localhost:3000/dashboard.html');
  console.log('   After jobs finish, check GitHub for build-report.json commits:');
  console.log('   https://github.com/dheemanthjn/simulated-jenkins-demo/branches');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error('   Make sure the server is running first: npm run dev');
});
