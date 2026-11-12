#!/bin/bash
# SessionStart hook (see CLAUDE.md): everything printed on stdout is added to the
# session's context, so keep npm's output on stderr.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}"

# 1) Dependencies, in cloud sessions only. Skipped unless a hashed file changed
#    since the last successful install (the hash file lives in node_modules).
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  hashes=node_modules/.session-start.sha256
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    # Delete the old hashes first, so a failed install runs again next time
    rm -f "$hashes"
    npm install --no-audit --no-fund >&2
    sha256sum .claude/hooks/session-start.sh package.json package-lock.json >"$hashes" 2>/dev/null || rm -f "$hashes"
  fi
fi

# 2) Hand-off notes: CLAUDE.md says to read HANDOFF.md before starting work.
if [ -f HANDOFF.md ]; then
  echo "=== HANDOFF.md (สถานะงานที่ส่งต่อ — อ่านก่อนเริ่มงานตาม CLAUDE.md) ==="
  cat HANDOFF.md
  echo "=== จบ HANDOFF.md ==="
fi
