// Runs every tests/test-*.js against the built main.js; exits non-zero on the first failure.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
for (const f of fs.readdirSync(__dirname).filter((n) => /^test-.*\.js$/.test(n)).sort()) {
  console.log(`== tests/${f}`);
  execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
}
