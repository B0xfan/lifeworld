// A PDF's text through poppler's pdftotext, or null when pdftotext is not installed.
const { spawnSync } = require('child_process');
module.exports = (file) => {
  const r = spawnSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' });
  if (r.error && r.error.code === 'ENOENT') return null;
  if (r.status !== 0) throw new Error(`pdftotext could not read ${file}: ${r.stderr || r.error}`);
  return r.stdout;
};
