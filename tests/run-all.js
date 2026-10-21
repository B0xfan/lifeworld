// Runs every tests/test-*.js against the built files; runs them all, then lists every failing file.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const failed = [];
for (const f of fs.readdirSync(__dirname).filter((n) => /^test-.*\.js$/.test(n)).sort()) {
  console.log(`== tests/${f}`);
  if (spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }).status !== 0) failed.push(f);
}
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'all test files passed');
process.exit(failed.length ? 1 : 0);
