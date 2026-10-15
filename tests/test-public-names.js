// Public code carries no old private-vault naming (phase 2 section 9). Scans every file the repo
// ships (tracked, new and not ignored) plus the built main.js and styles.css for the word "A4",
// "A4_"-style names, "a4-..." ids and the private team's names. Each hit must match one rule in
// KEEP below, which says why it stays; anything else fails, so a new mention cannot slip in.
// Personal data (names, paths, mail) is test-local-values.js's job.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

const LOOK = [
  /(?<![\w-])a4(?![\w-])/gi, // the word, "A4's", "[a4]"
  /(?<![\w-])a4[a-z]{0,2}_\w*/gi, // A4_VAULT, A4T_FONT_DATA
  /(?<![\w-])a4[a-z]{0,2}-[\w-]*/gi, // ids and classes
  /\bAudrey\b|\bAI Team\b|CLAUDE\.md|\bDex\b|business-ideas/gi, // the private team and its notes
];
const SRC = /^(src\/|main\.js$|styles\.css$)/; // the built files hold what src/ holds
const TESTS = /^tests\//;
// [what may stay, where, why]. Built main.js and styles.css count as src/.
const KEEP = [
  [/^a4-(today|planner|projects|sidebar)$/, /./, 'part ids: command ids, tab types, ribbon ids and settings corners (hotkeys and saved tabs survive), and the old plugin folders carry-over reads'],
  [/^a4-((today|planner|projects|sidebar)-view|sid)$/, TESTS, "test stand-ins for the parts' tab types, and a cut-off settings file"],
  [/^a4-today-capture$/, SRC, 'the capture link obsidian://a4-today-capture (saved links and the menu bar capture open it)'],
  [/^a4(t|pl|pj|sb)-|^a4-undo-/, /./, 'CSS class names (kept: themes and snippets may target them)'],
  [/^a4-(quick-create|health|finance|analytics|media)$/, SRC, 'commands of private add-ons the Sidebar and Today still call; the companion add-on job moves them out'],
  [/^a4-daily-planner$/, TESTS, 'tests that check the old daily planner id is gone from the code'],
  [/^A4$/, /^(src\/sidebar\/main\.js|main\.js)$/, "the Sidebar ribbon tooltip 'Open the A4 sidebar': Obsidian keys a ribbon button by id plus tooltip, so new words would reset the owner's ribbon order; phase 3 migration"],
  [/^(Audrey|AI Team)$/i, /^(src\/sidebar\/|main\.js$|styles\.css$|tests\/test-sidebar\.js$)/, 'the team badge and roster in the Sidebar; the companion add-on job moves them out'],
  [/^AI Team$/i, /^tests\/(fixtures\/|test-host\.js$|test-today\.js$|test-sidebar\.js$)/, "the owner-preset test vault's folder names (made-up notes in the owner's folder layout)"],
];

const files = [...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n'), 'main.js', 'styles.css']
  .filter((f, i, all) => f && all.indexOf(f) === i && f !== 'tests/test-public-names.js');
assert.ok(fs.existsSync(path.join(ROOT, 'main.js')), 'main.js is built (npm run build) before this check');
const bad = [];
const kept = {};
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue;
  // Long base64 runs (Today's bundled fonts) are data, not words: a chance "/A4+" there is no mention.
  const text = fs.readFileSync(p, 'utf8').replace(/[A-Za-z0-9+/=]{200,}/g, '');
  for (const re of LOOK) for (const m of text.matchAll(re)) {
    const rule = KEEP.find(([what, where]) => what.test(m[0]) && where.test(f));
    if (rule) { kept[rule[2]] = (kept[rule[2]] || 0) + 1; continue; }
    const line = text.slice(0, m.index).split('\n').length;
    bad.push(`${f}:${line}: "${m[0]}"`);
  }
}
assert.deepStrictEqual(bad, [], `old private naming in public code (reword it, or add a KEEP rule with its reason):\n${bad.join('\n')}`);
// The kept ribbon tooltip is the only "A4" word left; a second one in the Sidebar must fail too.
assert.strictEqual((fs.readFileSync(path.join(ROOT, 'src/sidebar/main.js'), 'utf8').match(LOOK[0]) || []).length, 1, 'one "A4" word in the Sidebar (the ribbon tooltip)');
console.log(`public names self-check: OK (${files.length} files)`);
for (const [why, n] of Object.entries(kept)) console.log(`  kept ${n}: ${why}`);
