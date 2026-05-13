// master/webhookHandler.js
const crypto = require('crypto');
const { enqueueJob }                         = require('./db');
const { broadcast }                          = require('./routes/events');
const { extractRoleFromPusher, QUEUE_LABELS } = require('./roleManager');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'mysecret';

// Detect language from changed files first, fall back to repo language
function detectLanguage(head_commit, repositoryLanguage) {
  const allFiles = [
    ...(head_commit?.added    || []),
    ...(head_commit?.modified || []),
    ...(head_commit?.removed  || []),
  ];
  const extMap = { '.py':'Python', '.java':'Java', '.js':'JavaScript', '.ts':'JavaScript', '.rb':'Ruby', '.go':'Go', '.rs':'Rust' };
  for (const file of allFiles) {
    const ext = '.' + file.split('.').pop().toLowerCase();
    if (extMap[ext]) return extMap[ext];
  }
  return repositoryLanguage || 'Generic';
}

function verifySignature(req) {
  if (!process.env.VERIFY_WEBHOOK_SIG || process.env.VERIFY_WEBHOOK_SIG === 'false') return true;
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function webhookHandler(req, res) {
  if (!verifySignature(req)) {
    console.warn('[WEBHOOK] ❌ Invalid signature — rejected');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  if (event !== 'push') {
    return res.status(200).json({ message: `Ignored event type: ${event}` });
  }

  const { ref, repository, pusher, head_commit } = req.body;
  if (!repository) return res.status(400).json({ error: 'Invalid payload — missing repository field' });

  const branch     = ref?.replace('refs/heads/', '') || 'unknown';
  const repoName   = repository.name;
  const pusherName = pusher?.name || 'intern-unknown';
  const language   = detectLanguage(head_commit, repository.language);
  const pusherRole = extractRoleFromPusher(pusherName);

  const job = enqueueJob({
    repo:        repoName,
    language,
    branch,
    commit_msg:  head_commit?.message || '',
    pusher:      pusherName,
    pusher_role: pusherRole,
  });

  const queueLabel = QUEUE_LABELS[job.queue_level];
  console.log(`[WEBHOOK] ✅ Job #${job.id} | ${pusherName} (${pusherRole}) → ${repoName}@${branch} | ${queueLabel}`);
  broadcast({ type: 'JOB_QUEUED', job });

  res.status(202).json({
    message:     'Job queued successfully',
    job_id:      job.id,
    pusher_role: pusherRole,
    queue_level: job.queue_level,
    queue_label: queueLabel,
    language,
  });
}

module.exports = webhookHandler;