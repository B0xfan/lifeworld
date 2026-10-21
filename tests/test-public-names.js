// Public code carries no old private-vault naming (phase 2 section 9). Scans every file the repo
// ships (tracked, new and not ignored) plus the built main.js and styles.css for the word "A4",
// "A4_"-style names, "a4-..." ids and the private team's names. Each hit must match one rule in
// KEEP below, which says why it stays; anything else fails, so a new mention cannot slip in.
// Personal data (names, paths, mail) is test-local-values.js's job.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pdfText = require('./lib/pdf-text');
const ROOT = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

const LOOK = [
  /(?<![\w-])a4(?![\w-])/gi, // the word, "A4's", "[a4]"
  /(?<![\w-])a4[a-z]{0,2}_\w*/gi, // A4_VAULT, A4T_FONT_DATA
  /(?<![\w-])a4[a-z]{0,2}-[\w-]*/gi, // ids and classes
  /(?<![\w-])A4[A-Z]\w*/g, // class and variable names (A4TodayPlugin)
  /\[a4-[a-z]+\]/gi, // console log prefixes ("[a4-today] ..."); public logs say LifeWorld
  /\bAudrey\b|\bAI Team\b|CLAUDE\.md|\bDex\b|business-ideas|\bAtlas\b/gi, // the private team, its notes and a retired private project
  /(?<![a-z])ink[\s_-]?line/gi, // the owner's third-party theme is never named (2026-10-19); its --ink-* tokens stay
];
const SRC = /^(src\/|main\.js$|styles\.css$)/; // the built files hold what src/ holds
const TESTS = /^tests\//;
// [what may stay, where, why]. Built main.js and styles.css count as src/.
const KEEP = [
  [/^a4-(today|planner|projects|sidebar)$/, /./, 'part ids: command ids, tab types, ribbon ids and settings corners (hotkeys and saved tabs survive), and the old plugin folders carry-over reads'],
  [/^a4-((today|planner|projects|sidebar)-view|sid)$/, TESTS, "test stand-ins for the parts' tab types, and a cut-off settings file"],
  [/^a4-today-capture$/, SRC, 'the capture link obsidian://a4-today-capture (saved links and the menu bar capture open it)'],
  [/^a4(t|pl|pj|sb)-|^a4-undo-/, /./, 'CSS class names (kept: themes and snippets may target them)'],
  [/^a4-daily-planner$/, TESTS, 'tests that check the old daily planner id is gone from the code'],
];

const files = [...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n'), 'main.js', 'styles.css']
  .filter((f, i, all) => f && all.indexOf(f) === i && f !== 'tests/test-public-names.js');
assert.ok(fs.existsSync(path.join(ROOT, 'main.js')), 'main.js is built (npm run build) before this check');
const bad = [];
const kept = {};
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
  // shortcut: pictures are not read (their bytes are not words); the README screenshots are checked by eye, from made-up notes only.
  if (/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
  // The PDF manual's bytes are compressed: its extracted text is scanned (skipped without pdftotext; test-manual-pdf.js ties it to README.md).
  const pdf = /\.pdf$/i.test(f) ? pdfText(p) : undefined;
  if (pdf === null) continue;
  // Long base64 runs (Today's bundled fonts) are data, not words: a chance "/A4+" there is no mention.
  const text = (pdf ?? fs.readFileSync(p, 'utf8')).replace(/[A-Za-z0-9+/=]{200,}/g, '');
  for (const re of LOOK) for (const m of text.matchAll(re)) {
    const rule = KEEP.find(([what, where]) => what.test(m[0]) && where.test(f));
    if (rule) { kept[rule[2]] = (kept[rule[2]] || 0) + 1; continue; }
    const line = text.slice(0, m.index).split('\n').length;
    bad.push(`${f}:${line}: "${m[0]}"`);
  }
}
assert.deepStrictEqual(bad, [], `old private naming in public code (reword it, or add a KEEP rule with its reason):\n${bad.join('\n')}`);
console.log(`public names self-check: OK (${files.length} files)`);
for (const [why, n] of Object.entries(kept)) console.log(`  kept ${n}: ${why}`);
