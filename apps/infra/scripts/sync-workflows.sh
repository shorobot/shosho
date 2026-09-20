#!/usr/bin/env bash
# Source of truth for workflows is apps/infra/.github/workflows; copy them to /.github/workflows.
# CI fails if the two drift.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$ROOT/.github/workflows"
cp "$ROOT/apps/infra/.github/workflows/"*.yml "$ROOT/.github/workflows/"
diff -r "$ROOT/apps/infra/.github/workflows" "$ROOT/.github/workflows" && echo "workflows in sync"
