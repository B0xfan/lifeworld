#!/bin/sh
# Builds docs/LifeWorld-manual.pdf from README.md and its screenshots. Run again whenever the README changes.
# Needs pandoc and typst (brew install pandoc typst). No browser. The PDF lives in the repo for the
# "Open manual" button; it is never a release file (release.yml uploads only main.js, manifest.json, styles.css).
set -eu
cd "$(dirname "$0")/.."
REPO=https://github.com/B0xfan/lifeworld/blob/HEAD
# Relative links to repo files only work on GitHub; point them there so they work in the PDF too.
grep -q '^\*\*Built on TaskNotes\.\*\*' README.md || { echo 'TaskNotes credit paragraph not found in README.md' >&2; exit 1; }
# The README opens with the TaskNotes credit (GitHub page); the PDF carries that paragraph at the end instead.
awk '/^\*\*Built on TaskNotes\.\*\*/{c=1} c{if(/^$/){c=0;next} credit=credit $0 "\n";next} {print}
  END{printf "\n%s", credit}' README.md |
  sed -E "s#\]\((LICENSE|THIRD_PARTY_NOTICES\.md)\)#]($REPO/\1)#g" |
  nice -n 19 pandoc -f gfm -t typst --pdf-engine=typst \
    --shift-heading-level-by=-1 --metadata subtitle="User manual" \
    -V papersize=us-letter -V margin.x=2cm -V margin.y=2cm -V mainfont="Helvetica Neue" -V fontsize=10.5pt \
    -V include-before='#set par(justify: false)
#show table.cell: set align(left)
#show link: set text(fill: rgb("#1a5fb4"))' \
    -o docs/LifeWorld-manual.pdf -
echo "docs/LifeWorld-manual.pdf written"
