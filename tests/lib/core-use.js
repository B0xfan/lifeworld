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
  const stripped = src.replace(IMPORT_RE, (line, list, mod) => { imports[mod] = list.split(', '); return ''; });
  const a = ws(stripped); // esbuild renames a local that shadows a free name (x -> x2): counted as x
  const b = minified(stripped); // every declared (bound) name renamed; free names and strings stay
  const own = names.filter((x) => count(a, x, true) > count(b, x));
  const free = names.filter((x) => !own.includes(x));
  const c = free.length ? minified(`var ${free.join(', ')};\n${stripped}`) : b; // now every free use is bound too
  const used = free.filter((x) => count(b, x) > count(c, x));
  return { imports, own, used };
}
module.exports = { coreUse };
