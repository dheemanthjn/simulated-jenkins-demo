// scripts/setup-demo-branches.js
// Creates 3 repos × 2 branches = 6 branches on GitHub with real project files
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WT   = path.join(ROOT, '..', 'jenkins-worktrees'); // outside repo to avoid gitignore conflicts

function git(cmd, cwd = ROOT) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
}

// ── 3 repos × 2 branches each ─────────────────────────────────────────────────
const PROJECTS = [
  {
    name: 'api-service', language: 'Java',
    branches: ['main', 'develop'],
    files: (branch) => ({
      'pom.xml': `<project><modelVersion>4.0.0</modelVersion><groupId>com.demo</groupId><artifactId>api-service</artifactId><version>1.0-SNAPSHOT</version></project>`,
      'src/main/java/Application.java': `public class Application {\n  public static void main(String[] args) {\n    System.out.println("api-service running on branch: ${branch}");\n  }\n}`,
      'README.md': `# api-service\nBranch: \`${branch}\`\nLanguage: Java\nManaged by Jenkins CI/CD Simulator.\n`,
      'build-report.json': JSON.stringify({ status: 'not_built', branch }, null, 2),
    }),
  },
  {
    name: 'frontend-app', language: 'JavaScript',
    branches: ['main', 'feature/dashboard'],
    files: (branch) => ({
      'package.json': JSON.stringify({ name: 'frontend-app', version: '1.0.0', scripts: { build: 'echo build', test: 'echo test' } }, null, 2),
      'src/App.js': `// frontend-app — branch: ${branch}\nconst App = () => <div>Hello from {process.env.BRANCH || '${branch}'}</div>;\nexport default App;`,
      'src/index.js': `import React from 'react';\nimport App from './App';\nconsole.log('Running branch: ${branch}');`,
      'README.md': `# frontend-app\nBranch: \`${branch}\`\nLanguage: JavaScript / React\nManaged by Jenkins CI/CD Simulator.\n`,
      'build-report.json': JSON.stringify({ status: 'not_built', branch }, null, 2),
    }),
  },
  {
    name: 'data-pipeline', language: 'Python',
    branches: ['main', 'experimental/ml'],
    files: (branch) => ({
      'requirements.txt': 'pandas==2.0.0\nscikit-learn==1.3.0\nnumpy==1.24.0\n',
      'pipeline.py': `# data-pipeline — branch: ${branch}\nimport pandas as pd\n\ndef run():\n    print(f"Pipeline running on branch: ${branch}")\n    return {"status": "ok", "branch": "${branch}"}\n\nif __name__ == "__main__":\n    run()\n`,
      'README.md': `# data-pipeline\nBranch: \`${branch}\`\nLanguage: Python\nManaged by Jenkins CI/CD Simulator.\n`,
      'build-report.json': JSON.stringify({ status: 'not_built', branch }, null, 2),
    }),
  },
];

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

async function setupBranch(project, branchSuffix) {
  const branchName = `${project.name}/${branchSuffix}`;
  const safeName   = branchName.replace(/\//g, '_');
  const wtPath     = path.join(WT, safeName);

  console.log(`\n📦 Setting up branch: ${branchName}`);

  // Clean stale worktree
  if (fs.existsSync(wtPath)) {
    try { git(`worktree remove "${wtPath}" --force`); } catch {}
    fs.rmSync(wtPath, { recursive: true, force: true });
  }

  // Fetch so we know what exists remotely
  try { git('fetch origin --quiet'); } catch {}
  const remotes = git('branch -r').split('\n').map(s => s.trim());
  const exists  = remotes.includes(`origin/${branchName}`);

  if (exists) {
    // Check it out into a worktree
    git(`worktree add "${wtPath}" -b "_tmp_${safeName}" "origin/${branchName}"`);
  } else {
    // Create new branch from current HEAD
    git(`worktree add -b "${branchName}" "${wtPath}"`);
  }

  // Wipe and replace with project files
  try { execSync('git rm -rf . --quiet', { cwd: wtPath }); } catch {}
  writeFiles(wtPath, project.files(branchSuffix));

  // Commit
  execSync('git add .', { cwd: wtPath });
  try {
    execSync(
      `git commit -m "init(${branchName}): add ${project.language} project files"`,
      { cwd: wtPath, encoding: 'utf8' }
    );
  } catch(e) {
    if (!e.message.includes('nothing to commit')) throw e;
  }

  // Push (force OK for demo)
  execSync(`git push -u origin HEAD:"${branchName}" --force`, { cwd: wtPath, encoding: 'utf8' });
  console.log(`  ✅ ${branchName} → GitHub`);

  // Clean up worktree (keep files on disk for gitPush to reuse)
  git(`worktree remove "${wtPath}" --force`);
}

async function main() {
  console.log('🚀 Setting up 3 repos × 2 branches = 6 branches on GitHub\n');
  fs.mkdirSync(WT, { recursive: true });

  for (const project of PROJECTS) {
    for (const branch of project.branches) {
      await setupBranch(project, branch);
    }
  }
  console.log('\n✅ All 6 branches pushed to GitHub!');
  console.log('   https://github.com/dheemanthjn/simulated-jenkins-demo/branches');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
