# Simulated Jenkins CI/CD — Build Report

## ✅ What Was Built & Validated

### Live Test Results (just ran)
| Metric | Value |
|--------|-------|
| Total jobs processed | 13 |
| Successful | 8 |
| Failed (random chaos) | 5 |
| Avg job duration | ~11.8 seconds |
| Workers | 4 × IDLE (all returned correctly) |

All pipeline behaviours confirmed working:
- ✅ Webhook ingestion (`POST /webhook`) with HMAC signature support
- ✅ Job enqueue → SQLite persistence (sql.js, pure WASM)
- ✅ Priority queue: `main` branch = priority 1, feature branches = priority 5
- ✅ Language-aware scheduler: Python→worker-1, JS→worker-2, Java→worker-3, Generic→worker-4
- ✅ Fallback routing: Ruby/Go/unknown → GenWorker
- ✅ 5-stage pipeline simulation: Checkout → Install Deps → Build → Test → Deploy
- ✅ Randomised stage durations & per-stage failure rates (Test = 10% fail)
- ✅ SSE real-time broadcast to dashboard
- ✅ Dashboard at `http://localhost:3000/dashboard.html` (live in your browser)
- ✅ REST API: `/api/jobs`, `/api/jobs/meta/stats`, `/api/jobs/meta/workers`
- ✅ Simulate push buttons on dashboard (single + 10-job burst)

---

## 📁 Files Created

```
c:\Users\dheem\jenkins\
├── package.json                   ← deps: express, sql.js, dotenv, nodemon
├── .env                           ← PORT, WEBHOOK_SECRET, MASTER_URL
├── master/
│   ├── server.js                  ← Express entry point (async boot)
│   ├── db.js                      ← sql.js WASM SQLite (no native build)
│   ├── scheduler.js               ← 2s poll loop, priority routing, stale detection
│   ├── workerRegistry.js          ← 4 workers, pipeline stages, failure injection
│   ├── webhookHandler.js          ← GitHub push webhook + HMAC verify
│   ├── routes/
│   │   ├── jobs.js                ← REST API
│   │   └── events.js              ← SSE endpoint + broadcast()
│   └── public/
│       └── dashboard.html         ← Dark-mode real-time monitoring UI
├── scripts/
│   ├── simulate-push.js           ← CLI: simulate N pushes
│   └── load-test.js               ← CLI: burst N jobs
└── jenkins.db                     ← Auto-created SQLite file (persists jobs)
```

---

## 🖥️ How to Use Right Now

```powershell
# Server is already running. Keep that terminal open.

# Simulate a single push
node scripts/simulate-push.js

# Burst 10 jobs with 1s spacing
node scripts/load-test.js 10 1000

# Or use the dashboard buttons at:
# http://localhost:3000/dashboard.html

# Check stats via API
Invoke-RestMethod http://localhost:3000/api/jobs/meta/stats
Invoke-RestMethod http://localhost:3000/api/jobs/meta/workers
Invoke-RestMethod http://localhost:3000/api/jobs | ConvertTo-Json

# Cancel a pending job (replace 1 with a real PENDING job id)
Invoke-RestMethod -Method POST http://localhost:3000/api/jobs/1/cancel
```

---

## 🔧 What YOU Need to Do

### Required (to keep running after reboot)
- [ ] **Keep the server running** — the current process will die if you close the terminal. To make it persistent, run:
  ```powershell
  npm run dev   # uses nodemon for auto-reload on file changes
  ```
  Or install `pm2` for background persistence:
  ```powershell
  npm install -g pm2
  pm2 start master/server.js --name jenkins-sim
  pm2 save
  ```

### Optional — Real GitHub Webhook Integration
- [ ] **Install ngrok** to expose your local server to GitHub:
  ```powershell
  # Download ngrok from https://ngrok.com/download
  ngrok http 3000
  # Copy the https://xxxx.ngrok.io URL
  ```
- [ ] **Create a GitHub repo** (e.g. `simulated-jenkins-demo`)
- [ ] **Add a webhook** in that repo:
  - Go to **Settings → Webhooks → Add webhook**
  - Payload URL: `https://YOUR_NGROK_URL/webhook`
  - Content type: `application/json`
  - Secret: copy the value of `WEBHOOK_SECRET` from your `.env` file
  - Events: select **Just the push event**
- [ ] **Enable signature validation** in `.env`:
  ```
  VERIFY_WEBHOOK_SIG=true
  ```
  Then restart the server.

### Optional — Real git push triggering
- [ ] Add a `Jenkinsfile` to your GitHub repo (already provided in the PRD)
- [ ] Push any commit → GitHub sends webhook → your simulator picks it up

### Optional — Custom failure rates / stage timing
- Edit `PIPELINE_STAGES` in `master/workerRegistry.js`:
  ```js
  { name: 'Test', minMs: 2000, maxMs: 6000, failRate: 0.10 }
  //                                                    ↑ change this
  ```

### Optional — Add more workers
- Add to `WORKER_DEFINITIONS` in `master/workerRegistry.js`:
  ```js
  { id: 'worker-5', language: 'Go', name: 'GoWorker' },
  ```

---

## ⚠️ Known Behaviour Notes

| Behaviour | Reason |
|-----------|--------|
| Server takes ~1-2s to start | sql.js WASM init is async |
| `jenkins.db` grows over time | All jobs are persisted; delete the file to reset |
| ~25–30% of jobs will fail | By design — randomised chaos per stage |
| Cross-language fallback | Ruby/Go/unmatched → GenWorker (worker-4) |
| Jobs queue up when all 4 workers busy | Scheduler re-checks every 2s |

