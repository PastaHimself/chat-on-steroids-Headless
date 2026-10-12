#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -ne 0 ]] || { echo 'The backend must run unprivileged' >&2; exit 1; }
[[ "${COS_DATA_DIR:?}" = /* && "${COS_INSTALL_DIR:?}" = /* ]] || exit 1
mkdir -p "$COS_DATA_DIR"
[[ "${DBUS_SESSION_BUS_ADDRESS:-}" = unix:path=/run/cos-session/bus && -S /run/cos-session/bus ]] || { echo 'Start the private cos-session service first.' >&2; exit 1; }
cd "$COS_INSTALL_DIR"
exec "$COS_INSTALL_DIR/node_modules/electron/dist/electron" "$COS_INSTALL_DIR" --password-store=gnome-libsecret
