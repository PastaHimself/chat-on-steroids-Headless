#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -ne 0 ]] || { echo 'The secret service must run unprivileged' >&2; exit 1; }
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/cos-session/bus
[[ ! -e /run/cos-session/bus ]] || { echo 'Stale private session socket; restart the managed service.' >&2; exit 1; }
dbus-daemon --session --nofork --address="$DBUS_SESSION_BUS_ADDRESS" &
bus=$!
trap 'kill "$bus" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if busctl --address="$DBUS_SESSION_BUS_ADDRESS" list >/dev/null 2>&1; then break; fi
  sleep 1
done
busctl --address="$DBUS_SESSION_BUS_ADDRESS" list >/dev/null
if [[ -n "${CREDENTIALS_DIRECTORY:-}" && -r "$CREDENTIALS_DIRECTORY/keyring-password" ]]; then
  gnome-keyring-daemon --unlock --components=secrets --control-directory=/run/cos-session/keyring < "$CREDENTIALS_DIRECTORY/keyring-password" >/dev/null
else
  gnome-keyring-daemon --start --components=secrets --control-directory=/run/cos-session/keyring >/dev/null
  echo 'Private secret service started without unattended unlock; manual keyring intervention may be required.' >&2
fi
systemd-notify --ready
wait "$bus"
