# Jenkins CI/CD Simulator — Final Evaluation Report

**Project:** Simulated Jenkins CI/CD System with Preemptive Priority Scheduling  
**GitHub:** https://github.com/dheemanthjn/simulated-jenkins-demo

---

## 1. Project Overview

This project simulates a Jenkins-like CI/CD (Continuous Integration / Continuous Deployment) system built from scratch in Node.js.

**What it does:**
- Listens for GitHub push events via webhooks
- Assigns every push a **priority queue level (Q1–Q5)** based on the pusher's role and branch
- Schedules jobs on 4 simulated workers
- Runs a **5-stage pipeline**: Checkout → Install Deps → Build → Test → Deploy
- **Preempts** low-priority jobs when urgent work arrives
- Pushes CI results back to GitHub as `build-report.json` commits

---

## 2. System Architecture

```
Developer pushes code to GitHub
          │
          ▼ [GitHub fires webhook → ngrok tunnels to localhost:3000]
   webhookHandler.js  →  roleManager.js  →  db.js (SQLite)
          │
          ▼ [scheduler runs every 2 seconds]
   scheduler.js  →  workerRegistry.js  →  5-stage pipeline
          │
          ├── gitPush.js  →  build-report.json commit → GitHub
          └── routes/events.js (SSE)  →  dashboard.html (browser)
```

---

## 3. Core Features

### 3.1 Role-Based Priority Queue (`master/roleManager.js`)

Every push is assigned Q1–Q5 based on a 2D matrix of role × branch:

```
Role        │ main  develop  feature/*  testing  experimental/*
────────────┼────────────────────────────────────────────────────
admin       │  Q1    Q1       Q2         Q2        Q2
teamlead    │  Q1    Q2       Q2         Q3        Q3
developer   │  Q2    Q2       Q3         Q3        Q4
employee    │  Q3    Q3       Q4         Q4        Q5
intern      │  Q3    Q4       Q4         Q5        Q5
```

Q1 = highest priority (runs first). Q5 = lowest (runs last, never ignored forever).

**How role is detected:** From GitHub username via `GITHUB_USER_ROLES` map, or from pusher name prefix (e.g. `admin-alice` → admin).

---

### 3.2 Preemptive Scheduling (`master/preemptionManager.js`, `scheduler.js`, `workerRegistry.js`)

**Analogy:** Hospital emergency room. A heart attack patient (Q1) jumps ahead of a cold patient (Q5). The doctor doesn't abandon the cold patient — they pause and resume later.

**Step by step:**
1. All 4 workers are busy with Q5 jobs. A Q1 job arrives.
2. Scheduler calls `findPreemptionCandidate()` — finds the worker running the lowest-priority job.
3. Calls `signalPreemption(victimJobId)` — sets an in-memory flag.
4. The victim worker checks `isPreempted(jobId)` before every stage.
5. Flag detected → worker saves progress (`resume_from_stage`) → marks job `PAUSED` → goes IDLE.
6. Next scheduler tick → Q1 job assigned to the freed worker → runs immediately.
7. Q1 finishes → paused Q5 job resumes from its last completed stage.

**Key:** This is **cooperative preemption** — jobs pause at safe boundaries (between stages), not mid-execution. No data loss.

```javascript
const preemptionFlags = new Set();
function signalPreemption(jobId) { preemptionFlags.add(jobId); }   // O(1)
function isPreempted(jobId)      { return preemptionFlags.has(jobId); } // O(1)
function clearPreemption(jobId)  { preemptionFlags.delete(jobId); } // O(1)
```

---

### 3.3 Starvation Prevention (`master/scheduler.js`)

**Problem:** If Q1 jobs keep arriving, Q5 jobs never run (starvation).

**Fix:** A second timer runs every 10 seconds. Jobs waiting too long are promoted:

```
Q5 > 120s  → promoted to Q4
Q4 > 240s  → promoted to Q3
Q3 > 420s  → promoted to Q2
Q2 > 720s  → promoted to Q1
```

The dashboard shows `⬆ promoted` badges on affected jobs.

---

### 3.4 5-Stage Pipeline (`master/workerRegistry.js`)

| Stage | Min | Max | Fail Rate | Real-world equivalent |
|-------|-----|-----|-----------|----------------------|
| Checkout | 0.8s | 2.0s | 2% | `git clone` |
| Install Deps | 1.5s | 4.0s | 5% | `npm install` / `pip install` |
| Build | 2.0s | 5.0s | 8% | Compile / bundle |
| Test | 2.0s | 5.0s | 10% | Unit + integration tests |
| Deploy | 0.8s | 2.0s | 3% | Push to server |

Failure rates simulate real flaky builds. Preemption check runs before every stage.

---

### 3.5 Worker Registry (`master/workerRegistry.js`)

Four concurrent workers (Node.js `async/await`, not threads):

| Worker | Language | Falls back to |
|--------|----------|--------------|
| worker-1 | Python | Generic |
| worker-2 | JavaScript | Generic |
| worker-3 | Java | Generic |
| worker-4 | Generic | anything |

JavaScript is single-threaded — concurrency is achieved with `async/await` + `setTimeout`.

---

### 3.6 Real-Time Dashboard — Server-Sent Events (`master/routes/events.js`)

SSE is a one-way HTTP push protocol. Browser opens one long-lived connection to `/events`. Server pushes events when anything changes.

**Events broadcast:** `JOB_QUEUED`, `JOB_STARTED`, `STAGE_STARTED`, `STAGE_COMPLETED`, `PREEMPTION_TRIGGERED`, `JOB_PREEMPTED`, `JOB_RESUMED`, `JOB_COMPLETED`, `JOB_PROMOTED`, `WORKER_BUSY`, `WORKER_IDLE`.

**Why SSE over WebSockets:** SSE is simpler, works over plain HTTP, auto-reconnects, sufficient for server→client only.

---

### 3.7 GitHub Webhook Integration (`master/webhookHandler.js`)

**What is a webhook?** GitHub POSTs to your URL the moment a push happens. You don't poll — GitHub calls you.

**Handler steps:**
1. Verify HMAC-SHA256 signature (payload integrity check)
2. Ignore non-push events (ping, PR, etc.)
3. Extract repo, branch, pusher name, commit message, file types
4. Detect language from file extensions (`.java` → Java, `.py` → Python)
5. Determine role from GitHub username mapping
6. `enqueueJob()` → broadcast `JOB_QUEUED` → return `202 Accepted`

---

### 3.8 Git Push Back — CI Results to GitHub (`master/gitPush.js`)

After every job, a `build-report.json` is committed to the matching GitHub branch showing the CI result. Uses a serial queue to prevent concurrent git conflicts.

**Example commit:** `ci(api-service/main): ✅ Job #5 SUCCESS | Q1 | 14.2s`

---

## 4. Key Files

| File | Purpose |
|------|---------|
| `master/server.js` | Entry point, Express server |
| `master/db.js` | SQLite database layer (sql.js / WebAssembly) |
| `master/roleManager.js` | Priority matrix, role detection, starvation thresholds |
| `master/scheduler.js` | Dispatch loop (2s) + starvation loop (10s) |
| `master/workerRegistry.js` | Workers, pipeline, preemption checks |
| `master/preemptionManager.js` | In-memory flag Set |
| `master/webhookHandler.js` | GitHub push event parser |
| `master/gitPush.js` | Push CI results back to GitHub |
| `master/routes/events.js` | SSE endpoint and broadcast |
| `master/routes/jobs.js` | REST API |
| `master/public/dashboard.html` | Real-time browser dashboard |
| `scripts/demo.js` | Full narrated terminal demo |
| `scripts/commit.js` | CLI to commit + trigger CI with role |
| `scripts/trigger-all-branches.js` | Fire all 6 branches at once |

---

## 5. The 3 Repositories & 6 Branches

| Repository | Branch | Language | Role | Queue |
|-----------|--------|----------|------|-------|
| [api-service](https://github.com/dheemanthjn/api-service) | `main` | Java | admin | Q1 |
| api-service | `develop` | Java | teamlead | Q2 |
| [frontend-app](https://github.com/dheemanthjn/frontend-app) | `main` | JavaScript | admin | Q1 |
| frontend-app | `feature/dashboard` | JavaScript | developer | Q3 |
| [data-pipeline](https://github.com/dheemanthjn/data-pipeline) | `main` | Python | teamlead | Q2 |
| data-pipeline | `experimental/ml` | Python | intern | Q5 |

---

## 6. How ngrok Works

**Problem:** Your CI server runs on `localhost:3000`. GitHub cannot reach `localhost`.

**Solution:** ngrok creates a secure tunnel from a public URL to your local port.

```
GitHub
  │  POST https://abc123.ngrok.io/webhook
  ▼
ngrok cloud (public internet)
  │  forwarded through encrypted tunnel
  ▼
ngrok agent (running on your laptop)
  │  forwarded to
  ▼
localhost:3000/webhook  ← your Express server
```

**Why it works through firewalls:** The tunnel is initiated outward from your machine (like opening a website). Firewalls block inbound connections but allow outbound. ngrok keeps a persistent outbound connection open through which inbound webhook traffic is reversed.

**Start ngrok:**
```powershell
ngrok http 3000
# → Forwarding  https://abc123.ngrok.io → http://localhost:3000
```

**The `POST / 404` in ngrok logs:** This is GitHub's "ping" request sent when you first save the webhook. It hits `/` (root) which doesn't exist — harmless.

---

## 7. Where the Webhook is Registered on GitHub

Webhooks are registered **per repository**.

**To view:**
1. Go to: `https://github.com/dheemanthjn/frontend-app/settings/hooks`
2. You will see the webhook entry with the ngrok URL

**Configuration:**
- **Payload URL:** `https://YOUR-NGROK-URL.ngrok.io/webhook`
- **Content type:** `application/json`
- **Secret:** matches `WEBHOOK_SECRET` in `.env` (used for HMAC verification)
- **Events:** Push event only

**Flow after webhook fires:**
```
git push → GitHub signs payload with HMAC-SHA256 → POST to webhook URL
→ our server verifies signature → extracts event data → creates CI job
```

---

## 8. How to Deploy on Cloud

### Option A — AWS EC2

```bash
# 1. Launch Ubuntu EC2 instance (t2.micro, free tier)
# 2. SSH in and install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 3. Clone and install
git clone https://github.com/dheemanthjn/simulated-jenkins-demo
cd simulated-jenkins-demo && npm install

# 4. Run with PM2 (auto-restart on crash/reboot)
npm install -g pm2
pm2 start master/server.js --name jenkins-ci
pm2 startup && pm2 save

# 5. Open port 3000 in EC2 Security Group inbound rules
# 6. Update GitHub webhook to: http://YOUR-EC2-PUBLIC-IP:3000/webhook
```

### Option B — Railway / Render (zero config)

```
1. Sign up at railway.app
2. New Project → Deploy from GitHub → select simulated-jenkins-demo
3. Add env vars: PORT, WEBHOOK_SECRET, GITHUB_TOKEN
4. Railway gives public URL automatically
5. Update GitHub webhooks to the Railway URL
```

### Required changes for production:

| Change | Reason |
|--------|--------|
| Replace sql.js with PostgreSQL | sql.js data lost on restart |
| Store DB on persistent volume | Containers reset on redeploy |
| Add HTTPS/SSL | Required by GitHub for webhooks |
| Add dashboard authentication | Protect job data |
| Environment variables for secrets | Never hardcode tokens |

---

## 9. Under What Circumstances Would the System Fail?

| Failure | Cause | Symptom | Fix |
|---------|-------|---------|-----|
| **Port conflict** | Another Node process on 3000 | Server crashes at start (`EADDRINUSE`) | Kill old process |
| **ngrok URL changed** | ngrok restarted (free tier changes URL) | Webhook fires but server doesn't see it | Update webhook URL in GitHub Settings |
| **Webhook signature mismatch** | `.env` secret ≠ GitHub secret | All webhooks return 401 | Match both secrets |
| **No preemption possible** | Q3 job arrives, all workers on Q2 | Job stays PENDING (correct behavior) | Starvation timer promotes it eventually |
| **gitPush.js fails** | No GitHub credentials or network down | Build-report not committed (non-fatal) | CI result still saved in local DB |
| **Database corruption** | Server killed mid-write | Server fails to start | Delete `jenkins.db` and restart |
| **Race condition (theoretical)** | Two scheduler ticks assign same job | Job runs twice | Prevented by JS single-thread model |
| **Memory growth (long-running)** | Millions of jobs, SSE clients not cleaned | Increasing RAM usage | Add job archiving, limit DB size |

---

## 10. API Reference

| Method | Endpoint | Description |
|--------|---------|-------------|
| GET | `/health` | Server health + timestamp |
| GET | `/api/jobs` | List all jobs (latest 50) |
| GET | `/api/jobs/:id` | Single job details |
| GET | `/api/jobs/by-queue/1` | Jobs in Q1 only |
| GET | `/api/jobs/meta/stats` | Totals, avg time, preemption count |
| GET | `/api/jobs/meta/workers` | All worker statuses |
| GET | `/api/jobs/meta/queues` | Count per queue level |
| POST | `/simulate-push` | Trigger CI job manually |
| POST | `/webhook` | GitHub push event receiver |
| GET | `/events` | SSE stream (real-time) |
| GET | `/dashboard.html` | Browser dashboard |

---

## 11. Demo Commands for Evaluation

```powershell
# Terminal 1 — Server
cd C:\Users\dheem\jenkins && npm run dev

# Terminal 2 — Full narrated demo
npm run demo

# Show priority ordering
npm run trigger-all

# Demonstrate preemption manually
for ($i=1; $i -le 4; $i++) { node scripts/commit.js --preset intern-exp --ci-only; Start-Sleep -Milliseconds 400 }
Start-Sleep -Seconds 4
node scripts/commit.js --preset admin-prod --ci-only

# Show stats
curl http://localhost:3000/api/jobs/meta/stats | python -m json.tool

# Show workers
curl http://localhost:3000/api/jobs/meta/workers | python -m json.tool
```

---

## Key Terms Glossary

| Term | Meaning |
|------|---------|
| **CI/CD** | Auto-build, test, deploy on every push |
| **Webhook** | URL GitHub calls when an event happens |
| **Priority Queue** | Queue where higher-priority items run first |
| **Preemption** | Pausing a running job for a more urgent one |
| **Starvation** | When low-priority jobs never get processed |
| **SSE** | Server-Sent Events — server pushes data to browser |
| **HMAC-SHA256** | Cryptographic signature to verify webhook authenticity |
| **sql.js** | SQLite compiled to WebAssembly — no native binaries needed |
| **ngrok** | Tunnel from public internet to localhost |
| **Cooperative preemption** | Jobs pause voluntarily at safe boundaries |

---

*Jenkins CI/CD Simulator — Built with Node.js, Express, SQLite (sql.js), SSE, GitHub Webhooks*
