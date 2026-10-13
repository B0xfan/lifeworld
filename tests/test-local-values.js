// Owner-only values never reach the public repo.
// 1. local.json (owner-only build values) is ignored by git and not tracked.
// 2. A fixed deny-list, stored as SHA-256 hashes so the list itself leaks nothing (owner's
//    names, client names), plus plain patterns that are not private (home paths, mail
//    addresses, a local interpreter). Checked on every word and word pair, so it also guards
//    GitHub, where there is no local.json.
// 3. When local.json exists here, none of its values appear either.
// Scans tracked files and new files git does not ignore.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

assert.strictEqual(git('check-ignore', 'local.json').trim(), 'local.json', 'local.json is ignored by git');
assert.ok(!git('ls-files').split('\n').includes('local.json'), 'local.json is not tracked');

const DENY_HASHES = new Set([
  '26443cb491433cc627b0b3f7e585e407786b56ef23f67b51083346c4873a9b83',
  '39249eb85da2434001da8aa5b55b191a3acd9c3dc6b5f0f85d3cfb50ff96520e',
  '80f1818b055ef38db430c54964c94849c2213e9625842a7cbb9b6c950bbd406d',
  '96d9632f363564cc3032521409cf22a852f2032eec099ed5967c0d000cec607a',
  '6b076c1b258b09138c5bbf6f7b9f1d5daab299979fee30e4b3851b6d56295130',
  'f4c4c9f01674d5b552f5b511917f250a2ac2bcaac7846c9977cf47b0da57d932',
  'f940423697d128a1ef75751b168bb04e5b381ba52611c94c22c3c03e9cffa899',
  '2f05b87e7599936c87c393a5c31ad461c17e268703e9bec8b2e13835094223d8',
  '11bf92004f96b9729fa3d5f05f930bf364160474786d21f1b294ab1d8f8380f9',
]);
const DENY_PATTERNS = [/\/Users\/[^/\s'"`]+/, /@gmail\.com/i, /mini[c]onda/i];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

let local = [];
const file = path.join(ROOT, 'local.json');
if (fs.existsSync(file)) local = Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))).filter((v) => typeof v === 'string' && v);

const files = [...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
const hits = [];
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
  const text = fs.readFileSync(p, 'utf8').normalize('NFC');
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (DENY_HASHES.has(sha(words[i])) || (i + 1 < words.length && DENY_HASHES.has(sha(`${words[i]} ${words[i + 1]}`)))) { hits.push(`${f}: a deny-listed word`); break; }
  }
  for (const re of DENY_PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
  for (const v of local) if (text.includes(v)) hits.push(`${f}: a local.json value`);
}
assert.deepStrictEqual(hits, [], `private values found:\n${hits.join('\n')}`);
console.log(`local values self-check: OK (${files.length} files, ${DENY_HASHES.size} hashed words, ${DENY_PATTERNS.length} patterns, ${local.length} local values)`);
