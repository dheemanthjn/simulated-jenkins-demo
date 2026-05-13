// scripts/create-github-repos.js
// Creates 3 real GitHub repos and pushes project files + 2 branches each
const { execSync } = require('child_process');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN    = process.argv[2];
const USERNAME = 'dheemanthjn';

if (!TOKEN) { console.error('Usage: node create-github-repos.js <token>'); process.exit(1); }

// ── GitHub API helper ──────────────────────────────────────────────────────────
function apiPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request({
      hostname: 'api.github.com', path: endpoint, method: 'POST',
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent':    'jenkins-ci-simulator',
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function apiDelete(endpoint) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', path: endpoint, method: 'DELETE',
      headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'jenkins-ci-simulator' },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end();
  });
}

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Project templates ──────────────────────────────────────────────────────────
const REPOS = [
  {
    name: 'api-service',
    desc: 'Java REST API — managed by Jenkins CI/CD Simulator',
    language: 'Java',
    branches: {
      'main': {
        'pom.xml': `<?xml version="1.0"?>\n<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.demo</groupId>\n  <artifactId>api-service</artifactId>\n  <version>1.0.0</version>\n  <packaging>jar</packaging>\n</project>`,
        'src/main/java/Application.java': `public class Application {\n    public static void main(String[] args) {\n        System.out.println("API Service starting on main...");\n    }\n}`,
        'src/main/java/UserController.java': `public class UserController {\n    public String getUsers() { return "[]"; }\n    public String createUser(String body) { return body; }\n}`,
        'README.md': `# api-service\n\nJava REST API service.\n\n## Branches\n- \`main\` — production\n- \`develop\` — integration\n\n## CI/CD\nThis repo is connected to the Jenkins CI/CD Simulator.\nEvery push triggers a 5-stage pipeline: Checkout → Install → Build → Test → Deploy.\n\n## Build Status\nSee \`build-report.json\` for the latest CI result.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'main', repo: 'api-service' }, null, 2),
      },
      'develop': {
        'pom.xml': `<?xml version="1.0"?>\n<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.demo</groupId>\n  <artifactId>api-service</artifactId>\n  <version>1.1.0-SNAPSHOT</version>\n  <packaging>jar</packaging>\n</project>`,
        'src/main/java/Application.java': `public class Application {\n    public static void main(String[] args) {\n        System.out.println("API Service starting on develop...");\n    }\n}`,
        'src/main/java/PaymentController.java': `public class PaymentController {\n    public String processPayment(String body) {\n        // WIP: OAuth2 integration\n        return "{\"status\":\"pending\"}";\n    }\n}`,
        'README.md': `# api-service — develop\n\nIntegration branch. Merges into \`main\` after QA.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'develop', repo: 'api-service' }, null, 2),
      },
    },
  },
  {
    name: 'frontend-app',
    desc: 'JavaScript/React frontend — managed by Jenkins CI/CD Simulator',
    language: 'JavaScript',
    branches: {
      'main': {
        'package.json': JSON.stringify({ name:'frontend-app', version:'1.0.0', private:true, scripts:{ start:'node src/index.js', build:'echo "building..."', test:'echo "testing..."' }, dependencies:{ react:'18.0.0' } }, null, 2),
        'src/index.js': `const React = require('react');\nconsole.log('frontend-app running on main');\n`,
        'src/App.js': `// Main application component\nconst App = () => {\n  return { type: 'div', props: { children: 'Hello from api-service!' } };\n};\nmodule.exports = App;\n`,
        'src/components/Header.js': `const Header = ({ title }) => ({ type:'header', props:{ children: title } });\nmodule.exports = Header;\n`,
        'README.md': `# frontend-app\n\nReact frontend application.\n\n## Branches\n- \`main\` — production\n- \`feature/dashboard\` — analytics dashboard\n\n## CI/CD\nConnected to Jenkins CI/CD Simulator.\nSee \`build-report.json\` for latest CI result.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'main', repo: 'frontend-app' }, null, 2),
      },
      'feature/dashboard': {
        'package.json': JSON.stringify({ name:'frontend-app', version:'1.1.0-beta', private:true, scripts:{ start:'node src/index.js', build:'echo "building dashboard..."', test:'echo "testing dashboard..."' }, dependencies:{ react:'18.0.0', 'chart.js':'4.0.0' } }, null, 2),
        'src/index.js': `const React = require('react');\nconsole.log('frontend-app running on feature/dashboard');\n`,
        'src/components/Dashboard.js': `// Analytics Dashboard — WIP\nconst Dashboard = () => {\n  const data = { visits: 0, conversions: 0 };\n  return { type:'div', props:{ className:'dashboard', children: JSON.stringify(data) } };\n};\nmodule.exports = Dashboard;\n`,
        'src/components/Charts.js': `// Chart components — WIP\nconst LineChart = ({ data }) => ({ type:'canvas', props:{ 'data-values': JSON.stringify(data) } });\nmodule.exports = { LineChart };\n`,
        'README.md': `# frontend-app — feature/dashboard\n\nNew analytics dashboard in progress.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'feature/dashboard', repo: 'frontend-app' }, null, 2),
      },
    },
  },
  {
    name: 'data-pipeline',
    desc: 'Python data processing pipeline — managed by Jenkins CI/CD Simulator',
    language: 'Python',
    branches: {
      'main': {
        'requirements.txt': 'pandas==2.0.3\nnumpy==1.24.4\nscikit-learn==1.3.0\nrequests==2.31.0\n',
        'pipeline.py': `#!/usr/bin/env python3\n"""Main data pipeline — production branch."""\n\nimport json\nfrom datetime import datetime\n\ndef extract(source: str) -> list:\n    print(f"Extracting from {source}...")\n    return [{"id": i, "value": i * 10} for i in range(100)]\n\ndef transform(data: list) -> list:\n    return [{"id": d["id"], "value": d["value"] * 2, "ts": datetime.utcnow().isoformat()} for d in data]\n\ndef load(data: list, dest: str) -> bool:\n    print(f"Loading {len(data)} records to {dest}")\n    return True\n\nif __name__ == "__main__":\n    raw  = extract("s3://data-lake/raw")\n    data = transform(raw)\n    ok   = load(data, "postgresql://db/warehouse")\n    print("Pipeline complete:", ok)\n`,
        'tests/test_pipeline.py': `import sys, os\nsys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))\nfrom pipeline import extract, transform\n\ndef test_extract():\n    result = extract("test")\n    assert len(result) == 100\n    assert result[0]["id"] == 0\n\ndef test_transform():\n    data   = [{"id": 1, "value": 5}]\n    result = transform(data)\n    assert result[0]["value"] == 10\n\nif __name__ == "__main__":\n    test_extract()\n    test_transform()\n    print("All tests passed")\n`,
        'README.md': `# data-pipeline\n\nPython ETL data pipeline.\n\n## Branches\n- \`main\` — production pipeline\n- \`experimental/ml\` — ML model experiments\n\n## CI/CD\nConnected to Jenkins CI/CD Simulator.\nSee \`build-report.json\` for latest CI result.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'main', repo: 'data-pipeline' }, null, 2),
      },
      'experimental/ml': {
        'requirements.txt': 'pandas==2.0.3\nnumpy==1.24.4\nscikit-learn==1.3.0\ntorch==2.0.0\ntransformers==4.30.0\n',
        'pipeline.py': `#!/usr/bin/env python3\n"""ML experiment branch — not production ready."""\n\nimport json\nfrom datetime import datetime\n\ndef load_model(path: str):\n    print(f"Loading ML model from {path}...")\n    return {"weights": [], "config": {"layers": 3}}\n\ndef predict(model, data: list) -> list:\n    print(f"Running inference on {len(data)} samples...")\n    return [{"input": d, "prediction": 0.5, "confidence": 0.82} for d in data]\n\nif __name__ == "__main__":\n    model   = load_model("models/v2-experimental")\n    samples = list(range(10))\n    results = predict(model, samples)\n    print(f"Predictions: {json.dumps(results[:2], indent=2)}")\n`,
        'models/config.json': JSON.stringify({ version:'v2-experimental', layers:3, hidden_size:256, dropout:0.1, epochs:50, batch_size:32 }, null, 2),
        'README.md': `# data-pipeline — experimental/ml\n\nML model experiments. Not production ready.\n`,
        'build-report.json': JSON.stringify({ status: 'not_built', branch: 'experimental/ml', repo: 'data-pipeline' }, null, 2),
      },
    },
  },
];

// ── Create one repo and push both branches ─────────────────────────────────────
async function createRepo(repoDef) {
  console.log(`\n━━━ Creating ${repoDef.name} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // 1. Create repo on GitHub
  const created = await apiPost('/user/repos', {
    name:        repoDef.name,
    description: repoDef.desc,
    private:     false,
    auto_init:   false,
  });

  if (created.errors || created.message === 'Repository creation failed.') {
    // Might already exist
    console.log(`  ℹ️  Repo may already exist, continuing...`);
  } else {
    console.log(`  ✅ Created: ${created.html_url}`);
  }
  await sleep(1000);

  const remoteUrl = `https://${TOKEN}@github.com/${USERNAME}/${repoDef.name}.git`;
  const tmpBase   = path.join(__dirname, '..', '..', `_tmp_${repoDef.name}`);

  const branchEntries = Object.entries(repoDef.branches); // [[branchName, files], ...]

  for (let b = 0; b < branchEntries.length; b++) {
    const [branchName, files] = branchEntries[b];
    const tmpDir = `${tmpBase}_${branchName.replace(/\//g, '_')}`;

    console.log(`\n  📦 Branch: ${branchName}`);

    // Clean up any previous temp dir
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // Init git
    git('init', tmpDir);
    git(`config user.email "ci@jenkins-sim.local"`, tmpDir);
    git(`config user.name "Jenkins CI Simulator"`, tmpDir);

    // Write project files
    for (const [rel, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    // Stage + commit
    git('add .', tmpDir);
    git(`commit -m "init(${branchName}): add ${repoDef.language} project files"`, tmpDir);

    // Push to the correct branch
    git(`remote add origin ${remoteUrl}`, tmpDir);
    if (b === 0) {
      // First branch: becomes default (push as main or named)
      git(`push -u origin HEAD:${branchName} --force`, tmpDir);
    } else {
      git(`push -u origin HEAD:${branchName} --force`, tmpDir);
    }
    console.log(`    ✅ ${branchName} → github.com/${USERNAME}/${repoDef.name}`);

    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('🚀 Creating 3 real GitHub repositories\n');
  for (const repo of REPOS) {
    await createRepo(repo);
  }
  console.log('\n\n✅ All 3 repositories created!\n');
  console.log(`  🔗 https://github.com/${USERNAME}/api-service`);
  console.log(`  🔗 https://github.com/${USERNAME}/frontend-app`);
  console.log(`  🔗 https://github.com/${USERNAME}/data-pipeline`);
  console.log('\n⚠️  Remember to REVOKE your GitHub token now:');
  console.log('   https://github.com/settings/tokens');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
