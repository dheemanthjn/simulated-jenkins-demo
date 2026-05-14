# System Architecture — Jenkins CI/CD Simulator

---

## 1. High-Level Overview

```mermaid
flowchart TD
    DEV["👨‍💻 Developer\n(git push)"]
    GH["☁️ GitHub\n(api-service / frontend-app / data-pipeline)"]
    NGROK["🌐 ngrok\n(public tunnel)"]
    SERVER["🖥️ Express Server\nlocalhost:3000"]
    WH["webhookHandler.js"]
    RM["roleManager.js\nPriority Matrix Q1–Q5"]
    DB["🗄️ SQLite Database\n(sql.js / WebAssembly)"]
    SCHED["⏱️ scheduler.js\nDispatch every 2s\nStarvation every 10s"]
    PM["preemptionManager.js\nIn-memory flag Set"]
    WR["workerRegistry.js\n4 Workers"]
    GP["gitPush.js\nbuild-report.json"]
    SSE["routes/events.js\nServer-Sent Events"]
    DASH["📊 dashboard.html\nReal-time Browser UI"]
    GHBACK["☁️ GitHub\nbuild-report.json commit"]

    DEV -->|"git push"| GH
    GH -->|"POST /webhook"| NGROK
    NGROK -->|"forwards to"| SERVER
    SERVER --> WH
    WH --> RM
    RM -->|"queue level Q1–Q5"| DB
    DB -->|"PENDING jobs"| SCHED
    SCHED -->|"preemption signal"| PM
    SCHED -->|"assign job"| WR
    PM -->|"flag checked\nbetween stages"| WR
    WR -->|"job complete"| GP
    WR -->|"broadcast events"| SSE
    GP -->|"commit result"| GHBACK
    SSE -->|"live updates"| DASH
```

---

## 2. Priority Queue — Role × Branch Matrix

```mermaid
graph LR
    subgraph ROLES["Pusher Roles"]
        A["👑 admin"]
        B["🧑‍💼 teamlead"]
        C["👨‍💻 developer"]
        D["👷 employee"]
        E["🎓 intern"]
    end

    subgraph BRANCHES["Branch Types"]
        M["main / master"]
        DV["develop"]
        F["feature/*"]
        T["testing"]
        EX["experimental/*"]
    end

    subgraph QUEUES["Queue Levels"]
        Q1["🔴 Q1\nProduction Critical"]
        Q2["🟠 Q2\nIntegration"]
        Q3["🔵 Q3\nFeature Work"]
        Q4["🟢 Q4\nTesting"]
        Q5["⚫ Q5\nExperimental"]
    end

    A --> Q1
    B --> Q1
    B --> Q2
    C --> Q2
    C --> Q3
    D --> Q3
    D --> Q4
    E --> Q3
    E --> Q5
```

---

## 3. Preemption Flow (State Machine)

```mermaid
stateDiagram-v2
    [*] --> PENDING : webhook received\nenqueueJob()

    PENDING --> RUNNING : scheduler picks job\nworker is IDLE

    RUNNING --> PAUSED : 🚩 preemption flag set\nQ1 job arrived, no idle workers\npauses at stage boundary

    PAUSED --> PENDING : re-enters queue\nresume_from_stage saved

    PENDING --> RUNNING : worker freed\nresumes from saved stage

    RUNNING --> SUCCESS : all 5 stages pass ✅
    RUNNING --> FAILURE : a stage fails ❌

    SUCCESS --> [*]
    FAILURE --> [*]

    PENDING --> PENDING : starvation timer\npromotes Q5→Q4→Q3→Q2→Q1
```

---

## 4. Pipeline Stage Execution

```mermaid
sequenceDiagram
    participant S as scheduler.js
    participant W as workerRegistry.js
    participant P as preemptionManager.js
    participant D as db.js
    participant E as events.js (SSE)

    S->>W: assignJobToWorker(worker, job)
    W->>E: broadcast WORKER_BUSY

    loop For each stage (0→4)
        W->>P: isPreempted(jobId)?
        alt Preemption flagged
            W->>D: pauseJob(jobId, stageIndex)
            W->>E: broadcast JOB_PREEMPTED
            W->>P: clearPreemption(jobId)
            W->>E: broadcast WORKER_IDLE
            Note over W: exits loop early
        else Not preempted
            W->>E: broadcast STAGE_STARTED
            W->>W: executeStage() — wait random ms
            alt Stage passes
                W->>D: markStageComplete(jobId, stageName)
                W->>E: broadcast STAGE_COMPLETED (ok)
            else Stage fails
                W->>D: updateJobStatus(FAILURE)
                W->>E: broadcast STAGE_COMPLETED (failed)
                Note over W: exits loop early
            end
        end
    end

    W->>D: updateJobStatus(SUCCESS/FAILURE)
    W->>E: broadcast JOB_COMPLETED
    W->>E: broadcast WORKER_IDLE
```

---

## 5. Webhook → Job Creation Flow

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant NG as ngrok
    participant WH as webhookHandler.js
    participant RM as roleManager.js
    participant DB as db.js
    participant SSE as events.js

    GH->>NG: POST /webhook\n(x-hub-signature-256 header)
    NG->>WH: forwards request
    WH->>WH: verifySignature()\nHMAC-SHA256 check
    WH->>WH: check x-github-event == "push"
    WH->>WH: extract branch, repo,\npusher, commit message
    WH->>RM: extractRoleFromPusher(pusherName)
    RM-->>WH: "admin" / "intern" / etc.
    WH->>RM: getQueueLevel(role, branch)
    RM-->>WH: 1 (Q1) ... 5 (Q5)
    WH->>DB: enqueueJob({repo, branch, role, queue})
    DB-->>WH: job object (id, status=PENDING)
    WH->>SSE: broadcast JOB_QUEUED
    WH-->>GH: 202 Accepted
```

---

## 6. Starvation Prevention Timer

```mermaid
gantt
    title Starvation Promotion Timeline
    dateFormat ss
    axisFormat %Ss

    section Q5 Job (intern)
    Waiting at Q5          : 0, 120s
    Promoted to Q4         : milestone, 120s, 0s

    section Q4 Job (employee)
    Waiting at Q4          : 0, 240s
    Promoted to Q3         : milestone, 240s, 0s

    section Q3 Job (developer)
    Waiting at Q3          : 0, 420s
    Promoted to Q2         : milestone, 420s, 0s

    section Q2 Job (teamlead)
    Waiting at Q2          : 0, 720s
    Promoted to Q1         : milestone, 720s, 0s
```

---

## 7. Git Push Back — CI Results to GitHub

```mermaid
sequenceDiagram
    participant W as workerRegistry.js
    participant GP as gitPush.js
    participant TMP as Temp Directory
    participant GH as GitHub

    W->>GP: pushBuildResult(job)\n[non-blocking, queued]
    Note over GP: serial queue — one push at a time

    GP->>TMP: create temp dir
    GP->>GH: git clone --depth 1 --branch api-service/main
    GH-->>TMP: shallow clone
    GP->>TMP: write build-report.json\n{status, duration, stages, role, queue}
    GP->>TMP: git commit -m "ci(api-service/main): ✅ Job #5 SUCCESS | Q1 | 14.2s"
    GP->>GH: git push origin api-service/main
    GP->>TMP: rm -rf temp dir
```

---

## 8. The 3 Repositories & 6 Branches

```mermaid
graph TB
    subgraph GH["☁️ GitHub — dheemanthjn"]

        subgraph R1["📦 api-service (Java)"]
            R1M["main\n👑 admin → Q1"]
            R1D["develop\n🧑‍💼 teamlead → Q2"]
        end

        subgraph R2["📦 frontend-app (JavaScript)"]
            R2M["main\n👑 admin → Q1"]
            R2F["feature/dashboard\n👨‍💻 developer → Q3"]
        end

        subgraph R3["📦 data-pipeline (Python)"]
            R3M["main\n🧑‍💼 teamlead → Q2"]
            R3E["experimental/ml\n🎓 intern → Q5"]
        end
    end

    CI["🖥️ CI/CD Simulator\nlocalhost:3000"]

    R1M -->|"webhook"| CI
    R1D -->|"webhook"| CI
    R2M -->|"webhook"| CI
    R2F -->|"webhook"| CI
    R3M -->|"webhook"| CI
    R3E -->|"webhook"| CI

    CI -->|"build-report.json commit"| R1M
    CI -->|"build-report.json commit"| R1D
    CI -->|"build-report.json commit"| R2M
    CI -->|"build-report.json commit"| R2F
    CI -->|"build-report.json commit"| R3M
    CI -->|"build-report.json commit"| R3E
```

---

## 9. ngrok Tunnel Architecture

```mermaid
graph LR
    DEV["👨‍💻 Your Laptop\nlocalhost:3000"]
    AGENT["ngrok agent\n(running locally)"]
    CLOUD["ngrok cloud\n(public servers)"]
    GH["☁️ GitHub\nWebhook sender"]

    DEV <-->|"internal"| AGENT
    AGENT <-->|"persistent outbound\nencrypted tunnel"| CLOUD
    GH -->|"POST https://abc123.ngrok.io/webhook"| CLOUD

    style CLOUD fill:#f0883e,color:#000
    style GH fill:#238636,color:#fff
    style DEV fill:#1f6feb,color:#fff
    style AGENT fill:#6e40c9,color:#fff
```

**Why it works through firewalls:**
- The tunnel is opened **outbound** from your machine (like a browser)
- Firewalls block inbound connections but allow outbound
- GitHub's POST request travels: GitHub → ngrok cloud → reverse through tunnel → your machine

---

## 10. Component Dependency Map

```mermaid
graph TD
    SERVER["server.js\n(Entry Point)"]

    SERVER --> DB["db.js\n(SQLite)"]
    SERVER --> WH["webhookHandler.js"]
    SERVER --> JR["routes/jobs.js"]
    SERVER --> ER["routes/events.js"]
    SERVER --> SCHED["scheduler.js"]
    SERVER --> WReg["workerRegistry.js"]

    WH --> DB
    WH --> RM["roleManager.js"]
    WH --> ER

    SCHED --> DB
    SCHED --> WReg
    SCHED --> PM["preemptionManager.js"]
    SCHED --> RM
    SCHED --> ER

    WReg --> DB
    WReg --> PM
    WReg --> ER
    WReg --> GP["gitPush.js"]

    JR --> DB
```

---

*Render this file in VS Code with the **Markdown Preview Mermaid Support** extension, or paste any diagram block into [mermaid.live](https://mermaid.live)*
