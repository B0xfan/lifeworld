#!/usr/bin/env bash
# Install this build of LifeWorld in a vault's plugin folder, named by $LIFEWORLD_PLUGIN_DIR.
#
#   scripts/deploy-to-vault.sh            # back up, copy, say if data.json changed meanwhile
#   scripts/deploy-to-vault.sh --dry-run  # show what would change, copy nothing
#
# Copies only main.js, manifest.json and styles.css. Never writes data.json; the backup goes outside the vault.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(main.js manifest.json styles.css)
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") DRY=0 ;;
  -h|--help) sed -n "2,7p" "$0"; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac
fail() { echo "deploy: $*" >&2; exit 1; }
DEST="${LIFEWORLD_PLUGIN_DIR:?Set LIFEWORLD_PLUGIN_DIR to the plugin folder in the vault}"

[ -f "$DEST/manifest.json" ] || fail "no manifest.json in $DEST; refusing to install into an unknown folder"
read_id() { node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).id' "$1"; }
[ "$(read_id "$REPO/manifest.json")" = lifeworld ] || fail "this repo's manifest is not LifeWorld"
[ "$(read_id "$DEST/manifest.json")" = lifeworld ] || fail "$DEST does not hold LifeWorld"
for f in "${FILES[@]}"; do [ -s "$REPO/$f" ] || fail "missing or empty $REPO/$f"; done
node --check "$REPO/main.js" || fail "main.js does not parse"

for f in "${FILES[@]}"; do cmp -s "$REPO/$f" "$DEST/$f" || echo "  changed: $f"; done
[ "$DRY" = 0 ] || { echo "Dry run: nothing copied."; exit 0; }

BACKUP="$HOME/Backups/lifeworld-live-$(date +%Y-%m-%d-%H%M%S)"
mkdir -p "$BACKUP"
for f in "${FILES[@]}"; do cp -p "$DEST/$f" "$BACKUP/$f"; done
[ ! -f "$DEST/data.json" ] || cp -p "$DEST/data.json" "$BACKUP/data.json"
before="$(shasum "$DEST/data.json" 2>/dev/null || true)"
# Every copy first, so a full disk stops here with the old files all in place.
drop_new() { for f in "${FILES[@]}"; do rm -f "$DEST/$f.new"; done; }
restore() {
  drop_new; local back=yes
  for f in "${FILES[@]}"; do cp -p "$BACKUP/$f" "$DEST/$f" || back=no; done
  [ "$back" = yes ] && fail "$1; the old version is back (backup: $BACKUP)"
  fail "$1; could not put the old version back, copy the files from $BACKUP"
}
for f in "${FILES[@]}"; do cp "$REPO/$f" "$DEST/$f.new" || { drop_new; fail "could not copy $f; nothing changed"; }; done
for f in "${FILES[@]}"; do mv "$DEST/$f.new" "$DEST/$f" || restore "could not install $f"; done
for f in "${FILES[@]}"; do cmp "$REPO/$f" "$DEST/$f" || restore "$f did not copy cleanly"; done
# This script never writes it, but a running Obsidian may: worth a look, not a failed install.
[ "$before" = "$(shasum "$DEST/data.json" 2>/dev/null || true)" ] || echo "deploy: note: data.json changed during the install (Obsidian or Sync saved it); the earlier copy is in $BACKUP" >&2
echo "Installed $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version' "$DEST/manifest.json"); backup in $BACKUP"
