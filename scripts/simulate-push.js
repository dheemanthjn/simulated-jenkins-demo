// scripts/simulate-push.js
const crypto = require('crypto');
const http = require('http');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mysecret';
const MASTER_URL = process.env.MASTER_URL || 'http://localhost:3000';

const LANGUAGES = ['Python', 'JavaScript', 'Java', 'Ruby', 'Go'];
const REPOS     = ['api-service', 'frontend-app', 'data-pipeline', 'auth-service'];
const BRANCHES  = ['main', 'main', 'main', 'feature/new-login', 'feature/fix-bug', 'develop'];
const MESSAGES  = [
  'fix: resolve memory leak',
  'feat: add new endpoint',
  'refactor: clean up auth module',
  'chore: update dependencies',
  'test: add unit tests',
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function simulatePush(overrides = {}) {
  const branch = overrides.branch || randomFrom(BRANCHES);
  const payload = {
    ref: `refs/heads/${branch}`,
    repository: {
      name:      overrides.repo     || randomFrom(REPOS),
      language:  overrides.language || randomFrom(LANGUAGES),
      full_name: `demo-org/${overrides.repo || randomFrom(REPOS)}`,
    },
    pusher: { name: overrides.pusher || 'dev-' + Math.floor(Math.random() * 5) },
    head_commit: {
      id:        Math.random().toString(36).substring(2, 10),
      message:   overrides.message  || randomFrom(MESSAGES),
      timestamp: new Date().toISOString(),
    },
  };

  const body = JSON.stringify(payload);
  const sig  = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const url  = new URL(`${MASTER_URL}/webhook`);

  const options = {
    hostname: url.hostname,
    port:     url.port || 80,
    path:     url.pathname,
    method:   'POST',
    headers: {
      'Content-Type':        'application/json',
      'Content-Length':      Buffer.byteLength(body),
      'X-GitHub-Event':      'push',
      'X-Hub-Signature-256': sig,
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[SIMULATE] ${payload.repository.language} push → ${payload.repository.name}@${branch}`);
        console.log(`[SIMULATE] Server: ${data}`);
        resolve(data);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// CLI usage: node simulate-push.js [count] [interval_ms]
const count    = parseInt(process.argv[2]) || 1;
const interval = parseInt(process.argv[3]) || 1000;

(async () => {
  for (let i = 0; i < count; i++) {
    await simulatePush();
    if (i < count - 1) {
      await new Promise(r => setTimeout(r, interval + Math.random() * 500));
    }
  }
})();
