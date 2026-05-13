// master/gitPush.js
// After each CI job, pushes a build-report.json to the matching GitHub branch.
// Uses a serial queue so concurrent jobs don't cause git conflicts.
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const REMOTE_URL = 'https://github.com/dheemanthjn/simulated-jenkins-demo.git';

// ── Serial queue ──────────────────────────────────────────────────────────────
const queue = [];
let busy    = false;

function enqueue(fn) { queue.push(fn); drain(); }

async function drain() {
  if (busy || queue.length === 0) return;
  busy = true;
  while (queue.length > 0) {
    try { await queue.shift()(); } catch(e) {
      console.warn('[GIT-PUSH] ⚠️', e.message.split('\n')[0]);
    }
  }
  busy = false;
}

// ── Main push function ────────────────────────────────────────────────────────
// Called by workerRegistry after every job completion (success OR failure)
function pushBuildResult(job) {
  // git branch name: e.g. "api-service/main", "frontend-app/feature/dashboard"
  const branchName = `${job.repo}/${job.branch}`;

  enqueue(async () => {
    const tmpDir = path.join(os.tmpdir(), `ci-push-${job.id}-${Date.now()}`);
    try {
      console.log(`[GIT-PUSH] Pushing result → ${branchName}`);

      // Shallow clone just this branch
      execSync(
        `git clone --depth 1 --branch "${branchName}" "${REMOTE_URL}" "${tmpDir}"`,
        { encoding: 'utf8', timeout: 45000, stdio: ['pipe','pipe','pipe'] }
      );

      // Set git identity for the commit
      execSync('git config user.email "ci@jenkins-sim.local"', { cwd: tmpDir });
      execSync('git config user.name "Jenkins CI Simulator"',  { cwd: tmpDir });

      // Write build report
      const report = {
        job_id:        job.id,
        status:        job.status,
        repo:          job.repo,
        branch:        job.branch,
        pusher:        job.pusher,
        pusher_role:   job.pusher_role,
        queue_level:   job.effective_queue,
        preempted:     job.preempted_count > 0,
        preempted_cnt: job.preempted_count,
        duration_s:    job.duration_ms ? +(job.duration_ms / 1000).toFixed(2) : null,
        stages_done:   JSON.parse(job.completed_stages || '[]'),
        completed_at:  new Date().toISOString(),
      };
      fs.writeFileSync(path.join(tmpDir, 'build-report.json'), JSON.stringify(report, null, 2));

      // Commit + push
      execSync('git add build-report.json', { cwd: tmpDir });
      const icon = job.status === 'SUCCESS' ? '✅' : '❌';
      const msg  = `ci(${branchName}): ${icon} Job #${job.id} ${job.status} | Q${job.effective_queue} | ${(job.duration_ms||0)/1000}s`;
      execSync(`git commit -m "${msg}"`, { cwd: tmpDir, encoding: 'utf8' });
      execSync(`git push origin "${branchName}"`, { cwd: tmpDir, timeout: 45000, stdio: ['pipe','pipe','pipe'] });

      console.log(`[GIT-PUSH] ✅ Committed to ${branchName}`);
    } catch(err) {
      // Non-fatal: the CI simulation still ran, we just couldn't push to GitHub
      const msg = err.stderr || err.message;
      if (msg.includes("branch") && msg.includes("not found")) {
        console.warn(`[GIT-PUSH] Branch "${branchName}" not on GitHub yet — run: node scripts/setup-demo-branches.js`);
      } else {
        console.warn(`[GIT-PUSH] Failed for ${branchName}: ${msg.split('\n')[0]}`);
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });
}

module.exports = { pushBuildResult };
