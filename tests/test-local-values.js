// Owner-only values never reach the public repo.
// 1. local.json (owner-only build values) is ignored by git and not tracked.
// 2. A fixed deny-list, stored as SHA-256 hashes so the list itself leaks nothing (owner's
//    names, client names), plus plain patterns that are not private (home paths, mail
//    addresses, a local interpreter). Checked on every word, word pair and joined word pair
//    ("FirstLast", also with up to 4 characters attached), so it also guards GitHub, where there is no local.json.
// 3. When local.json exists here, none of its values appear either.
// Scans tracked files, new files git does not ignore, and the built main.js and styles.css.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pdfText = require('./lib/pdf-text');
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
  '93015b79fac09e7a0f8bca7f7816dc81c4bc62ce589d2b7c0b2149d1941f0ab9',
  'a929c5789c0b24603ed0180c0a64ce9616335e0be903f2a51bebb2f2dbfc0a4c',
  '1cfcffbd0d0536e2b354a0bbe9a0df8f7c15b26293e99ce5bd468e1716154295',
  '8f613377728ddcd0a7574e664e1c9d9f29401d4e94ca0819d36f9bfb1338b63c',
  'dc8fc9914972958ea4054ddf6c6772cb4080f4e9fb0f50771550bfe160250454',
  '710c3906ca8b54f86c9e020d989792d03b9a0d8904d7b57b3f57e74ab1746625',
  '2035981c3a8e041e170fae1ac9e103e90accf7c56501d291ec407201aba03789',
  '510e8f2ffd0acd35770fff5485a0d528effc04dbcdf983fcebb7b76f24844255',
  'd0b2bd82411ee800d30e29782352582539da5c8d962a56abe46b8a52c7047d97',
  '01621148306fc8fb7c2b95eeb5c37e375f90db53cf8313ea87c9c34c05b7e0e5',
  'bc5bee2cdbfd265f320bec92db947938b1cdbdb4854532afcd9d225cfa58cf77',
  'c84db1a7145affd888443f04fd649ea3f989a09b6959aeb8f26bc1220e7a80f8',
  '48fe20b1438396c895f55de0692dfd3dc7dba7da2eeae343e4b3f5dfc6050f78',
  'd46dd0dee4e823ffe7fcfec9cab354258b6fe1aeaf2c2619044362c535e193df',
  '048ebfab88102e8ee88b595b11cdbea988873da0f963541fa4734530d5b0220b',
  '57c59fc48d890797418619aa8f7e58ef86214d95b27a38b25eec9d518e9fc739',
  '190ba558ea65be188a63485319a3ed839e91f8fe6c9e531c791a7120fc7d9210',
  '6701004c156b45828a6b705932d993767ccb486d0de65711d95edf6b95174628',
  '0d4f8c40a9ba6d332e8b243f51b1bf8c5674fa103575931f0c6f921f96747311',
  'ee54b1b1e9bc25ac1a66c95f090f384b3fca30b5277c8a201acbcde3ca9d1ddd',
]);
const DENY_PATTERNS = [/\/Users\/[^/\s'"`]+/, /@gmail\.com/i, /mini[c]onda/i];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const AUTHOR_HASH = '0276d68e560281a40ea4123337c269656e2fdca0fa2e658810f38dda07729f6b';

let local = [];
const file = path.join(ROOT, 'local.json');
if (fs.existsSync(file)) local = Object.values(JSON.parse(fs.readFileSync(file, 'utf8'))).filter((v) => typeof v === 'string' && v);

// The built main.js and styles.css too (ignored by git, but they are what a release ships).
const files = [...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n'), 'main.js', 'styles.css'].filter((f, i, all) => f && all.indexOf(f) === i);
const hits = [];
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
  // shortcut: pictures are not read (their bytes are not words); the README screenshots are checked by eye, from made-up notes only.
  if (/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
  // The PDF manual's bytes are compressed: its extracted text is scanned (skipped without pdftotext; test-manual-pdf.js ties it to README.md).
  const pdf = /\.pdf$/i.test(f) ? pdfText(p) : undefined;
  if (pdf === null) continue;
  let text = (pdf ?? fs.readFileSync(p, 'utf8')).normalize('NFC');
  // The one allowed spot: by the owner's 2026-10-16 rule his name is the author in the root manifest.json.
  // Only that field, only that exact value (hashed, case-sensitive), is blanked; all else is scanned as usual.
  if (f === 'manifest.json') { const m = JSON.parse(text); if (typeof m.author === 'string' && sha(m.author) === AUTHOR_HASH) { m.author = ''; text = JSON.stringify(m); } }
  // Same rule for the MIT licence's one copyright line (marketplace prep, 2026-10-20); only that line, only that name.
  if (f === 'LICENSE') text = text.replace(/^Copyright \(c\) \d{4} (.+)$/m, (line, who) => (sha(who) === AUTHOR_HASH ? '' : line));
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (DENY_HASHES.has(sha(words[i])) || (i + 1 < words.length && DENY_HASHES.has(sha(`${words[i]} ${words[i + 1]}`)))) { hits.push(`${f}: a deny-listed word`); break; }
  }
  // Joined spellings ("FirstLast", "xFirstLast2"): each word, and each with up to 4 characters cut
  // from either end, checked whole and at every split as a word pair.
  // shortcut: more than 4 attached characters are not caught; widen ATT if that ever matters.
  const ATT = 4;
  if (!hits.some((h) => h.startsWith(`${f}: a deny`))) {
    joined: for (const word of new Set(words)) {
      for (let a = 0; a <= ATT; a++) for (let b = 0; b <= ATT; b++) {
        const w = word.slice(a, word.length - b);
        if (w.length < 4) continue;
        if ((a || b) && DENY_HASHES.has(sha(w))) { hits.push(`${f}: a deny-listed word, with characters attached`); break joined; }
        for (let k = 1; k < Math.min(w.length, 40); k++) if (DENY_HASHES.has(sha(`${w.slice(0, k)} ${w.slice(k)}`))) { hits.push(`${f}: a deny-listed word pair, written joined`); break joined; }
      }
    }
  }
  for (const re of DENY_PATTERNS) if (re.test(text)) hits.push(`${f}: ${re}`);
  for (const v of local) if (text.includes(v)) hits.push(`${f}: a local.json value`);
}
assert.deepStrictEqual(hits, [], `private values found:\n${hits.join('\n')}`);
console.log(`local values self-check: OK (${files.length} files, ${DENY_HASHES.size} hashed words, ${DENY_PATTERNS.length} patterns, ${local.length} local values)`);
