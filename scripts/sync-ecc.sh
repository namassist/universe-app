#!/usr/bin/env bash
# Re-sync the curated ECC subset under .claude/ from upstream.
#
#   scripts/sync-ecc.sh [git-ref]        # default: main
#
# Only the components listed below are copied — the full ECC install pulls in
# ~490 files for languages this repo does not use. To add a component, add it
# to a list, run this script, and review the diff. Never hand-edit the copied
# files: put project-specific guidance in the root CLAUDE.md or apps/*/AGENTS.md
# instead, so a re-sync never loses it.
set -euo pipefail

REF="${1:-main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.claude"

AGENTS=(
  planner architect code-explorer code-architect code-reviewer
  typescript-reviewer react-reviewer database-reviewer security-reviewer
  build-error-resolver tdd-guide refactor-cleaner doc-updater
  silent-failure-hunter
)
COMMANDS=(
  plan feature-dev code-review build-fix react-review test-coverage
  refactor-clean update-docs security-scan learn checkpoint save-session
  resume-session
  orch-add-feature orch-change-feature orch-fix-defect orch-refine-code
)
SKILLS=(
  tdd-workflow verification-loop coding-standards backend-patterns
  frontend-patterns api-design bun-runtime react-patterns react-testing
  accessibility postgres-patterns redis-patterns database-migrations
  docker-patterns deployment-patterns security-review security-scan
  search-first git-workflow error-handling strategic-compact
  orch-pipeline orch-add-feature orch-change-feature orch-fix-defect
  orch-refine-code
)
RULES=(common typescript react web)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$REF" https://github.com/affaan-m/ECC.git "$TMP/ecc"
SRC="$TMP/ecc"

rm -rf "$DEST/agents" "$DEST/commands" "$DEST/rules/ecc"
for s in "${SKILLS[@]}"; do rm -rf "$DEST/skills/$s"; done
mkdir -p "$DEST/agents" "$DEST/commands" "$DEST/skills" "$DEST/rules/ecc"

for a in "${AGENTS[@]}"; do cp "$SRC/agents/$a.md" "$DEST/agents/"; done
for c in "${COMMANDS[@]}"; do cp "$SRC/commands/$c.md" "$DEST/commands/"; done
for s in "${SKILLS[@]}"; do cp -R "$SRC/skills/$s" "$DEST/skills/"; done
for r in "${RULES[@]}"; do cp -R "$SRC/rules/$r" "$DEST/rules/ecc/"; done
cp "$SRC/LICENSE" "$DEST/ECC-LICENSE"

VERSION="$(cat "$SRC/VERSION")"
COMMIT="$(git -C "$SRC" rev-parse HEAD)"
printf 'version=%s\ncommit=%s\n' "$VERSION" "$COMMIT" > "$DEST/ecc-version"
echo "Synced ECC $VERSION ($COMMIT). Review with: git diff -- .claude"
