#!/usr/bin/env bash
set -euo pipefail
for attempt in {1..30}; do
  if xdpyinfo -display "${DISPLAY:?}" >/dev/null 2>&1; then exit 0; fi
  sleep 1
done
echo 'Private virtual display did not become ready; inspect cos-display.service' >&2
exit 1
