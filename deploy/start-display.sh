#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -ne 0 ]] || { echo 'Virtual display must run unprivileged' >&2; exit 1; }
auth=/run/cos-display/Xauthority
[[ ! -L "$auth" ]] || { echo 'Refusing a linked Xauthority file' >&2; exit 1; }
touch "$auth"
cookie=$(openssl rand -hex 16)
printf 'add :99 . %s\n' "$cookie" | xauth -f "$auth" source -
unset cookie
exec Xvfb :99 -screen 0 1280x800x24 -nolisten tcp -auth "$auth" -noreset
