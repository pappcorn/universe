#!/usr/bin/env bash
# Build one uploadable .zip per skill, for people who use Claude in the chat
# (claude.ai, the Desktop chat, mobile) where plugins do not run.
#
# The zips come from the SAME folders the plugin installs from, so there is one
# source and two packagings. Each zip carries the skill folder at its root and
# only what Claude reads: SKILL.md plus references/, assets/ and scripts/ when
# they exist. GUIA.md (the step-by-step guide for people) stays out.
#
# Usage: bash build-kits.sh [output-dir]   (default: packages/cris-asiste/dist)
# No dependencies beyond bash and zip.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="$HERE/skills"
OUT="${1:-$HERE/dist}"

command -v zip >/dev/null || { echo "zip is required" >&2; exit 1; }
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

built=0
cd "$SKILLS"
for dir in */; do
  name="${dir%/}"
  [ -f "$name/SKILL.md" ] || continue
  items=("$name/SKILL.md")
  for d in references assets scripts; do
    [ -d "$name/$d" ] && items+=("$name/$d")
  done
  zip_path="$OUT/$name.zip"
  rm -f "$zip_path"
  zip -qr "$zip_path" "${items[@]}" -x '*.DS_Store'
  echo "built $zip_path"
  built=$((built + 1))
done

[ "$built" -gt 0 ] || { echo "no skills found under $SKILLS" >&2; exit 1; }
