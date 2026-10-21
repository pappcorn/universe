#!/usr/bin/env bash
# Build the Claude Projects instructions from the plugin's agent files.
#
# One source, two packagings: the plugin installs agents/<name>.md for Claude
# Code, and people who use a Project in the Claude app paste
# kit/instrucciones/<name>.md into the Project's instructions. That file is the
# agent's body with the frontmatter removed, so its first line is the version
# comment the agent checks to warn about stale pasted instructions.
#
# The kit is committed (people download it from GitHub) and the test fails if
# it drifts from the agents. After editing an agent, run this and commit both.
#
# Usage: bash build-kit.sh [output-dir]   (default: packages/finanzas-usa/kit)
# No dependencies beyond bash and awk.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/kit}"
mkdir -p "$OUT/instrucciones"

built=0
for agent in "$HERE"/agents/*.md; do
  name="$(basename "$agent" .md)"
  # Drop the frontmatter block and the blank line that follows it.
  awk 'NR==1 && $0=="---" {fm=1; next}
       fm && $0=="---" {fm=0; skip=1; next}
       fm {next}
       skip && $0=="" {skip=0; next}
       {skip=0; print}' "$agent" >"$OUT/instrucciones/$name.md"
  echo "built $OUT/instrucciones/$name.md"
  built=$((built + 1))
done

[ "$built" -gt 0 ] || { echo "no agents found under $HERE/agents" >&2; exit 1; }
