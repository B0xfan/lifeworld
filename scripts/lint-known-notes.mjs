// ESLint with a known-notes baseline: the warnings the owner accepted (lint-known-notes.json, per file and rule,
// exact counts) pass; any other finding fails, and so does a baseline count that no longer matches (shrink it).
// ESLint's own bulk suppressions only cover errors, and these are warnings, hence this script.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ESLint } from 'eslint';

const known = JSON.parse(readFileSync(new URL('../lint-known-notes.json', import.meta.url), 'utf8'));
const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);
const counts = {};
for (const r of results) for (const m of r.messages) {
  const key = `${relative(process.cwd(), r.filePath)} ${m.ruleId}`;
  (counts[key] ??= []).push(m);
}
let fail = false;
for (const key of new Set([...Object.keys(counts), ...Object.keys(known)])) {
  const found = counts[key]?.length ?? 0, allowed = known[key] ?? 0;
  if (found === allowed) continue;
  fail = true;
  console.error(found > allowed ? `NEW: ${key}: ${found} found, ${allowed} known` : `STALE: ${key}: ${found} found, ${allowed} known; lower the count in lint-known-notes.json`);
  if (found > allowed) for (const m of counts[key]) console.error(`  ${m.line}:${m.column} ${m.message}`);
}
const total = Object.values(known).reduce((a, b) => a + b, 0);
console.log(fail ? 'ESLint: FAILED against the known-notes baseline.' : `ESLint: only the ${total} known notes, nothing new.`);
process.exit(fail ? 1 : 0);
