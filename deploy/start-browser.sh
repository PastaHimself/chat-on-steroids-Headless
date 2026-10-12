#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -ne 0 ]] || { echo 'Brave must run unprivileged' >&2; exit 1; }
browser=${COS_BROWSER_EXECUTABLE:-/usr/bin/brave-browser}
profile=${COS_BROWSER_PROFILE:?}
[[ "$browser" = /* && -x "$browser" && "$profile" = /* && ! -L "$profile" ]] || { echo 'Validate the executable and dedicated profile paths' >&2; exit 1; }
mkdir -p "$profile"
exec "$browser" "--user-data-dir=$profile" --disable-renderer-backgrounding --disable-background-timer-throttling --no-first-run --password-store=gnome-libsecret --restore-last-session
