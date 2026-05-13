// scripts/load-test.js — Simulate a burst of pushes
const { execSync } = require('child_process');
const path = require('path');

const COUNT    = parseInt(process.argv[2]) || 10;
const INTERVAL = parseInt(process.argv[3]) || 500;

console.log(`\n🧪 Sending ${COUNT} simulated pushes with ~${INTERVAL}ms interval\n`);

const scriptPath = path.join(__dirname, 'simulate-push.js');

for (let i = 0; i < COUNT; i++) {
  setTimeout(() => {
    try {
      execSync(`node "${scriptPath}" 1`, { stdio: 'inherit' });
    } catch (e) {
      console.error(`Push #${i + 1} failed:`, e.message);
    }
  }, i * (INTERVAL + Math.random() * 300));
}
