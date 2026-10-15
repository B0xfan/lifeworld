# LifeWorld

An Obsidian plugin for projects, tasks and planning. In development, not yet released.

LifeWorld is one plugin with four parts: Projects (with the task engine), Today, Planner and Sidebar. `src/main.js` starts them; each part's code is in `src/<part>/`, the shared helpers in `src/core/`.

`npm run build` bundles `src/` with esbuild into `main.js` and `styles.css` at the repo root (with `manifest.json`, the plugin as Obsidian loads it; the tests load every part from that same file; built files are never committed). Optional owner-only values (`userName`, `syncPython`) go in `local.json`, which git ignores.

Tests: `npm test` (builds, then runs every `tests/test-*.js`). They run on every push and pull request. A few checks read a real vault and run only when `LIFEWORLD_VAULT=<vault folder>` is set.
