#!/usr/bin/env bash
# Live FD-leak smoke against the patched ctxloom MCP server.
#
# Runs in an isolated tmp project so it doesn't race with the global
# ctxloom MCP servers that Claude Code keeps attached to live windows.
#
# 1. Builds a tmp project with ~15 dummy TS files.
# 2. Spawns `node dist/index.js` with CTXLOOM_ROOT pointing at the tmp.
# 3. Touches a source file 300 times to cross the 200 compaction threshold.
# 4. Snapshots `lsof -p <pid> | wc -l` every 25 events.
# 5. Reports baseline → peak → final, with verdict.

set -euo pipefail

cd "$(dirname "$0")/.."
DIST_INDEX="$(pwd)/dist/index.js"
[ -f "$DIST_INDEX" ] || { echo "dist/index.js missing — run npm run build first"; exit 1; }

TMP=$(mktemp -d /tmp/ctxloom-fd-smoke.XXXXXX)
echo "[smoke] tmp project = $TMP"

# Seed project: enough files for indexer to do real work but bounded
mkdir -p "$TMP/src"
for i in $(seq 1 15); do
  cat > "$TMP/src/mod-$i.ts" <<EOF
export function mod$i(x: number): number {
  return x * $i;
}
EOF
done
cat > "$TMP/package.json" <<'EOF'
{"name":"ctxloom-fd-smoke","version":"0.0.0","type":"module","private":true}
EOF

# Keep stdin open so the MCP stdio server doesn't EOF and exit
FIFO=$(mktemp -u)
mkfifo "$FIFO"
exec 9<>"$FIFO"

# Patched server, pointed at the isolated tmp root
CTXLOOM_ROOT="$TMP" node "$DIST_INDEX" \
  < "$FIFO" \
  > /tmp/ctxloom-smoke.stdout \
  2> /tmp/ctxloom-smoke.stderr &
SERVER_PID=$!

cleanup() {
  echo
  echo "[smoke] cleaning up server PID $SERVER_PID + tmp $TMP"
  kill "$SERVER_PID" 2>/dev/null || true
  exec 9>&-
  rm -f "$FIFO"
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

echo "[smoke] spawned PID=$SERVER_PID, waiting 8s for index+watcher..."
sleep 8

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[smoke] FATAL: server died during boot. stderr:"
  tail -30 /tmp/ctxloom-smoke.stderr
  exit 1
fi

fd_count() {
  lsof -p "$SERVER_PID" 2>/dev/null | wc -l | tr -d ' '
}

TARGET="$TMP/src/mod-1.ts"
SAMPLES=()
LABELS=()

baseline=$(fd_count)
SAMPLES+=("$baseline"); LABELS+=("baseline")
printf '  %-14s FDs=%s\n' "baseline" "$baseline"

# Drive 12 batches × 25 events = 300 total — well past the 200 compact threshold
for batch in 1 2 3 4 5 6 7 8 9 10 11 12; do
  for _ in $(seq 1 25); do
    touch "$TARGET"
    sleep 0.08
  done
  # Brief pause so the watcher debounce flushes and compact() can settle
  sleep 0.6
  cur=$(fd_count)
  events=$((batch * 25))
  SAMPLES+=("$cur"); LABELS+=("+$events")
  printf '  %-14s FDs=%s\n' "+$events" "$cur"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[smoke] server died after $events events. stderr tail:"
    tail -20 /tmp/ctxloom-smoke.stderr
    exit 1
  fi
done

echo "[smoke] post-load settle (5s)..."
sleep 5
final=$(fd_count)
SAMPLES+=("$final"); LABELS+=("final")
printf '  %-14s FDs=%s\n' "final" "$final"

peak=0
for v in "${SAMPLES[@]}"; do
  [ "$v" -gt "$peak" ] && peak="$v"
done

delta=$((final - baseline))
peak_delta=$((peak - baseline))

echo
echo "[smoke] baseline=$baseline  peak=$peak  final=$final"
echo "[smoke] Δbaseline-to-final = $delta"
echo "[smoke] Δbaseline-to-peak  = $peak_delta"
echo

# Heuristic: with 300 events triggering ~300 upserts the unpatched code
# would add ~600 transactions = several hundred new mmap FDs (LanceDB
# keeps each fragment + manifest mapped). With the patch firing
# compact() at #200, peak should plateau and final should drop back.
if [ "$delta" -lt 500 ] && [ "$peak_delta" -lt 1500 ]; then
  echo "[smoke] VERDICT: PATCH ACTIVE ✓  (Δ < 500, peak Δ < 1500)"
  exit 0
else
  echo "[smoke] VERDICT: SUSPICIOUS  Δ=$delta peak Δ=$peak_delta"
  echo "[smoke] Inspect stderr at /tmp/ctxloom-smoke.stderr for clues."
  exit 1
fi
