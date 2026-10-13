# LifeWorld

An Obsidian plugin for projects, tasks and planning. In development, not yet released.

The code here is the Projects part (currently named "A4 Projects" in its manifest), plus the Today, Planner and Sidebar parts in `src/`, each still its own plugin until they are joined into one.

Source lives in `src/`; `npm run build` bundles it with esbuild into `main.js` at the repo root, and Today, Planner and Sidebar into `dist/<id>/` (none of it committed). Optional owner-only values (`userName`, `syncPython`) go in `local.json`, which git ignores.

Tests: `npm test` (builds, then runs every `tests/test-*.js`). They run on every push and pull request.
