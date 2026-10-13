// Owner-only build values (local.json) never reach the public repo: the file is ignored by git,
// not tracked, and (when it exists here) none of its values appear in any tracked file.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
assert.strictEqual(git('check-ignore', 'local.json').trim(), 'local.json', 'local.json is ignored by git');
assert.ok(!git('ls-files').split('\n').includes('local.json'), 'local.json is not tracked');
const file = path.join(ROOT, 'local.json');
let n = 0;
if (fs.existsSync(file)) {
  for (const v of Object.values(JSON.parse(fs.readFileSync(file, 'utf8')))) {
    if (typeof v !== 'string' || !v) continue;
    let hits = '';
    try { hits = git('grep', '-l', '-F', '-e', v); } catch (e) { if (e.status !== 1) throw e; } // 1 = no match
    assert.strictEqual(hits, '', `a local value appears in tracked files: ${hits}`);
    n++;
  }
}
console.log(`local values self-check: OK (${n} values checked against tracked files)`);
