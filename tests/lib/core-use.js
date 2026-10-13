// Which shared-core names a source file declares itself and which it uses, decided by esbuild's
// own scope analysis (not a line-start regex), so a copy written as let/var/class, an indented
// local or a destructured name is seen too. Used by tests/test-core.js.
const esbuild = require('esbuild');

const IMPORT_RE = /^const \{ ([^}]*) \} = require\('(?:\.\.\/core|\.)\/(\w+)'\);.*$/gm;
const ws = (code, more) => esbuild.transformSync(code, { loader: 'js', minifyWhitespace: true, ...more }).code;
const minified = (code) => ws(code, { minifyIdentifiers: true, format: 'cjs' });
// Identifier-like occurrences: not a property (`.x`), not an object key (`x:`), but a bare
// ternary value (`c?x:y`) and a `case x:` label are uses (esbuild prints both this way).
const count = (s, x, renamed) => {
  const id = `${x}${renamed ? '\\d*' : ''}`;
  return (s.match(new RegExp(`(?<![\\w$.])${id}(?![\\w$])(?!:)|(?<=\\?|case )${id}(?=:)`, 'g')) || []).length;
};

// -> { imports: { module: [names] }, own: [names], used: [names] } for the given core names.
function coreUse(src, names) {
  const imports = {};
  let stripped = src.replace(IMPORT_RE, (line, list, mod) => { imports[mod] = list.split(', '); return ''; });
  // Each name becomes a long token first, so a short name ('h', 'WD') can never be confused with
  // a name the minifier makes up. Strings and properties get the token too, the same in every print.
  const token = (x) => `__cu_${x}`;
  for (const x of names) stripped = stripped.replace(new RegExp(`(?<![\\w$])${x.replace(/\$/g, '\\$')}(?![\\w$])`, 'g'), token(x));
  const a = ws(stripped); // esbuild renames a local that shadows a free name (x -> x2): counted as x
  const b = minified(stripped); // every declared (bound) name renamed; free names and strings stay
  const own = names.filter((x) => count(a, token(x), true) > count(b, token(x)));
  const free = names.filter((x) => !own.includes(x));
  const c = free.length ? minified(`var ${free.map(token).join(', ')};\n${stripped}`) : b; // now every free use is bound too
  const used = free.filter((x) => count(b, token(x)) > count(c, token(x)));
  return { imports, own, used };
}
// -> { module: [names] } a source file imports from the shared core.
function importsOf(src) { const out = {}; for (const m of src.matchAll(IMPORT_RE)) out[m[2]] = m[1].split(', '); return out; }
// -> (name) => true when the file keeps no copy of `name` and imports it from the core whenever it
// uses it (a file that never uses a name need not import it, unless `mustUse` is set: then it must
// use it and import it).
function fromCore(src, names, mustUse = false) {
  const { own, used } = coreUse(src, names); const imported = Object.values(importsOf(src)).flat();
  return (x) => !own.includes(x) && (used.includes(x) ? imported.includes(x) : !mustUse);
}
module.exports = { coreUse, importsOf, fromCore };
