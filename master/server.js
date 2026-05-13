// master/server.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express  = require('express');
const path     = require('path');
const { initDB, enqueueJob } = require('./db');
const webhookHandler = require('./webhookHandler');
const jobRoutes  = require('./routes/jobs');
const eventRoutes = require('./routes/events');
const { broadcast } = require('./routes/events');
const { startScheduler } = require('./scheduler');
const { initWorkers }    = require('./workerRegistry');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ─────────────────────────────────────────────────────────
app.post('/webhook', webhookHandler);
app.use('/api/jobs', jobRoutes);
app.use('/events',   eventRoutes);

// Simulate push (no signature check, useful in dev)
app.post('/simulate-push', (req, res) => {
  const { extractRoleFromPusher } = require('./roleManager');
  const pusher     = req.body.pusher     || 'intern-unknown';
  // Accept explicit pusher_role from body, or extract it from the pusher name convention
  const pusherRole = req.body.pusher_role || extractRoleFromPusher(pusher);

  const job = enqueueJob({
    repo:        req.body.repo       || 'demo-repo',
    language:    req.body.language   || 'Python',
    branch:      req.body.branch     || 'main',
    commit_msg:  req.body.commit_msg || 'Manual simulation',
    pusher,
    pusher_role: pusherRole,
  });
  broadcast({ type: 'JOB_QUEUED', job });
  res.json({ status: 'queued', job });
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── Boot (async — waits for DB init before starting) ───────────────
async function main() {
  await initDB();        // sql.js init is async
  initWorkers();
  startScheduler();
  app.listen(PORT, () => {
    console.log(`\n🚀 Jenkins Master running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard : http://localhost:${PORT}/dashboard.html`);
    console.log(`🔗 Webhook   : http://localhost:${PORT}/webhook`);
    console.log(`💉 Simulate  : POST http://localhost:${PORT}/simulate-push\n`);
  });
}

main().catch(err => { console.error('Fatal boot error:', err); process.exit(1); });
