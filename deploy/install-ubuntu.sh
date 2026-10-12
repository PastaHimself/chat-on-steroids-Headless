#!/usr/bin/env bash
# Managed by Chat On Steroids headless deployment
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run this installer with sudo; runtime services remain unprivileged.' >&2; exit 1; }
source /etc/os-release
[[ "$ID" = ubuntu && "$VERSION_ID" = 24.04 && "$(dpkg --print-architecture)" = amd64 ]] || { echo 'This installer targets Ubuntu 24.04 amd64.' >&2; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd -P)
[[ -f "$repo/out/main/index.js" && -f "$repo/discord/dist/index.js" && -x "$repo/node_modules/electron/dist/electron" ]] || { echo 'Build and verify both packages as your login user before installing.' >&2; exit 1; }
[[ -x /usr/local/bin/node && "$(/usr/local/bin/node -p 'process.versions.node.split(".")[0]')" = 24 ]] || { echo 'Install verified Node.js 24 at /usr/local/bin/node first.' >&2; exit 1; }
# Preflight existing managed destinations before replacing a running installation.
destination=/opt/chat-on-steroids/current
[[ ! -L "$destination" && ! -L /etc/chat-on-steroids ]] || { echo 'Installation destinations must not be symlinks.' >&2; exit 1; }
if [[ -e "$destination" ]]; then
  [[ "${1:-}" = '--update' && -d "$destination" ]] || { echo 'Existing installation retained. Use --update after a backup and validation.' >&2; exit 1; }
fi
for unit in "$repo"/deploy/systemd/*; do
  target="/etc/systemd/system/$(basename "$unit")"
  [[ ! -L "$target" ]] || { echo "Refusing symlink $target" >&2; exit 1; }
  if [[ -e "$target" ]] && ! cmp -s "$unit" "$target"; then
    [[ "${1:-}" = '--update' && $(head -1 "$target") = '# Managed by Chat On Steroids headless deployment' ]] || { echo "Existing $target retained for manual review." >&2; exit 1; }
  fi
done
for envfile in backend discord; do
  [[ ! -L "/etc/chat-on-steroids/$envfile.env" ]] || { echo 'Environment files must not be symlinks.' >&2; exit 1; }
  if [[ -e "/etc/chat-on-steroids/$envfile.env" ]]; then
    [[ -f "/etc/chat-on-steroids/$envfile.env" && $(stat -c%u "/etc/chat-on-steroids/$envfile.env") = 0 && $(stat -c%a "/etc/chat-on-steroids/$envfile.env") = 600 ]] || { echo 'Existing environment files must be private and root-owned; retained for local validation.' >&2; exit 1; }
  fi
done
apt-get update
apt-get install -y xvfb xauth x11-utils dbus-x11 gnome-keyring libsecret-1-0 libnss3 libatk-bridge2.0-0 libgtk-3-0t64 libgbm1 libasound2t64 openssl curl ca-certificates ripgrep
if ! command -v brave-browser >/dev/null; then
  [[ ! -e /usr/share/keyrings/brave-browser-archive-keyring.gpg && ! -e /etc/apt/sources.list.d/brave-browser-release.sources ]] || { echo 'Existing Brave configuration needs manual validation.' >&2; exit 1; }
  temp=$(mktemp -d); trap 'rm -rf "$temp"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 -o "$temp/brave.gpg" https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
  curl --fail --location --proto '=https' --tlsv1.2 -o "$temp/brave.sources" https://brave-browser-apt-release.s3.brave.com/brave-browser.sources
  rg -q '^Signed-By: /usr/share/keyrings/brave-browser-archive-keyring.gpg$' "$temp/brave.sources" || { echo 'Unexpected Brave source configuration; review official installation instructions.' >&2; exit 1; }
  install -m 0644 "$temp/brave.gpg" /usr/share/keyrings/brave-browser-archive-keyring.gpg
  install -m 0644 "$temp/brave.sources" /etc/apt/sources.list.d/brave-browser-release.sources
  apt-get update; apt-get install -y brave-browser
fi
getent group cos-control >/dev/null || groupadd --system cos-control
[[ $(getent group cos-control | cut -d: -f3) -gt 0 ]] || { echo 'cos-control must be an unprivileged group.' >&2; exit 1; }
for account in cos-backend cos-discord; do
  [[ ! -L "/var/lib/$account" ]] || { echo 'Service homes must not be symlinks.' >&2; exit 1; }
  if id "$account" >/dev/null 2>&1; then
    [[ $(id -u "$account") -gt 0 && $(id -u "$account") -lt 1000 && $(id -gn "$account") = "$account" && $(getent passwd "$account" | cut -d: -f6) = "/var/lib/$account" ]] || { echo "Existing $account account needs manual validation." >&2; exit 1; }
  else useradd --system --user-group --home-dir "/var/lib/$account" --create-home --shell /usr/sbin/nologin "$account"; fi
  usermod -aG cos-control "$account"
  install -d -m 0700 -o "$account" -g "$account" "/var/lib/$account"
done
for folder in /var/lib/cos-backend/app /var/lib/cos-backend/brave /srv/cos-projects /opt/chat-on-steroids; do
  [[ ! -L "$folder" ]] || { echo "Refusing linked service directory $folder" >&2; exit 1; }
done
install -d -m 0700 -o cos-backend -g cos-backend /var/lib/cos-backend/app /var/lib/cos-backend/brave
install -d -m 0750 -o cos-backend -g cos-backend /srv/cos-projects
install -d -m 0700 /etc/chat-on-steroids
install -d -m 0755 /opt/chat-on-steroids
if [[ -e "$destination" ]]; then
  [[ "${1:-}" = '--update' && -d "$destination" && ! -L "$destination" ]] || { echo 'Existing installation retained. Use --update after a backup and validation.' >&2; exit 1; }
  systemctl stop cos-headless.target cos-discord.service cos-backend.service cos-browser.service cos-session.service cos-display.service
  mv "$destination" "/opt/chat-on-steroids/previous-$(date +%Y%m%d%H%M%S)"
fi
install -d -m 0755 "$destination"
for item in package.json package-lock.json LICENSE THIRD-PARTY-NOTICES.txt node_modules out extension discord deploy; do cp -a "$repo/$item" "$destination/"; done
for item in resources native; do [[ ! -d "$repo/$item" ]] || cp -a "$repo/$item" "$destination/"; done
chown -R root:root "$destination"
chmod -R go-w "$destination"
[[ -x "$destination/node_modules/electron/dist/chrome-sandbox" ]] || { echo 'Verified Electron sandbox helper is missing.' >&2; exit 1; }
chmod 4755 "$destination/node_modules/electron/dist/chrome-sandbox"
find "$destination/deploy" -name '*.sh' -exec chmod 0755 {} +
for envfile in backend discord; do
  [[ -e "/etc/chat-on-steroids/$envfile.env" ]] || install -m 0600 "$repo/deploy/$envfile.env.example" "/etc/chat-on-steroids/$envfile.env"
done
gid=$(getent group cos-control | cut -d: -f3)
sed -i "s/^COS_CONTROL_GID=REPLACE_LOCALLY$/COS_CONTROL_GID=$gid/" /etc/chat-on-steroids/backend.env
for unit in "$repo"/deploy/systemd/*; do
  target="/etc/systemd/system/$(basename "$unit")"
  if [[ -e "$target" ]] && ! cmp -s "$unit" "$target"; then
    cp -a "$target" "$target.bak-$(date +%Y%m%d%H%M%S)"
  fi
  install -m 0644 "$unit" "$target"
done
systemctl daemon-reload
echo 'Installed. Complete secure local bootstrap, interactive authentication and keyring provisioning before enabling the services. See docs/headless-vps.md.'
