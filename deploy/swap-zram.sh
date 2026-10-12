#!/usr/bin/env bash
# Optional managed 4 GiB LZ4 zram. Never repurpose an already active zram device.
set -euo pipefail
unit=/etc/systemd/system/cos-zram.service
expected=$(cat <<'UNIT'
# COS-MANAGED-ZRAM
[Unit]
Description=Optional CoS 4 GiB LZ4 zram
After=local-fs.target
Before=cos-backend.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/opt/chat-on-steroids/current/deploy/swap-zram.sh --activate
[Install]
WantedBy=multi-user.target
UNIT
)
if [[ "${1:-}" = '--check' ]]; then zramctl; swapon --show --bytes; exit 0; fi
[[ $EUID -eq 0 ]] || { echo 'Run optional zram setup with sudo.' >&2; exit 1; }
exec 9>/run/lock/cos-zram.lock; flock -x 9
if [[ "${1:-}" = '--activate' ]]; then
  modprobe zram num_devices=1
  [[ -e /sys/block/zram0/disksize && $(cat /sys/block/zram0/disksize) = 0 ]] || { echo 'zram0 is already configured; refusing to reset it.' >&2; exit 1; }
  grep -qw lz4 /sys/block/zram0/comp_algorithm || { echo 'The kernel does not offer LZ4 for zram.' >&2; exit 1; }
  zramctl /dev/zram0 --size 4G --algorithm lz4
  mkswap -L COS-ZRAM /dev/zram0
  swapon --priority 100 /dev/zram0
  exit 0
fi
if [[ "${1:-}" = '--rollback' ]]; then
  [[ -f "$unit" && ! -L "$unit" ]] || exit 0
  [[ $(cat "$unit") = "$expected" ]] || { echo 'Modified or unknown service retained for manual validation.' >&2; exit 1; }
  used=$(swapon --noheadings --bytes --show=NAME,USED | awk '$1 == "/dev/zram0" { print $2 }')
  if [[ -n "$used" ]]; then
    [[ $(blkid -s LABEL -o value /dev/zram0) = COS-ZRAM ]] || { echo 'zram ownership is not verified.' >&2; exit 1; }
    available=$(awk '/^MemAvailable:/ { print $2 * 1024 }' /proc/meminfo)
    [[ $(awk -v a="$available" -v u="$used" 'BEGIN { print a > u + 536870912 ? 1 : 0 }') = 1 ]] || { echo 'Insufficient free RAM for swapoff; free idle resources and retry.' >&2; exit 1; }
    swapoff /dev/zram0; zramctl --reset /dev/zram0
  elif [[ -e /sys/block/zram0/disksize && $(cat /sys/block/zram0/disksize) != 0 ]]; then
    [[ $(blkid -s LABEL -o value /dev/zram0) = COS-ZRAM ]] || { echo 'Inactive zram ownership is unconfirmed; retained for manual inspection.' >&2; exit 1; }
    zramctl --reset /dev/zram0
  fi
  systemctl disable --now cos-zram.service
  rm "$unit"; systemctl daemon-reload
  echo 'Managed zram removed; other swap settings retained.'
  exit 0
fi
[[ "${1:-}" = '' ]] || { echo 'Supported options: --check, --rollback' >&2; exit 1; }
if [[ -e "$unit" ]]; then
  [[ ! -L "$unit" && $(cat "$unit") = "$expected" ]] || { echo 'Existing service retained for manual validation.' >&2; exit 1; }
  if systemctl is-active --quiet cos-zram.service; then
    [[ $(cat /sys/block/zram0/disksize) = 4294967296 && $(blkid -s LABEL -o value /dev/zram0) = COS-ZRAM ]] || { echo 'Active service does not match managed zram; inspect locally.' >&2; exit 1; }
    grep -q '\[lz4\]' /sys/block/zram0/comp_algorithm || { echo 'Active compression differs; inspect locally.' >&2; exit 1; }
    [[ $(swapon --noheadings --show=NAME,PRIO | awk '$1 == "/dev/zram0" { print $2 }') = 100 ]] || { echo 'Active priority differs; inspect locally.' >&2; exit 1; }
    zramctl; swapon --show; exit 0
  fi
fi
for directory in /etc/systemd /run/systemd /usr/local/lib/systemd /usr/lib/systemd; do
  [[ ! -e "$directory/zram-generator.conf" && ! -d "$directory/zram-generator.conf.d" ]] || { echo 'An existing zram-generator configuration is present; review it instead of installing another owner.' >&2; exit 1; }
done
[[ ! -e /etc/default/zramswap ]] || { echo 'An existing zram-tools configuration is present; review that owner locally.' >&2; exit 1; }
if zramctl --noheadings --output NAME | grep -q .; then echo 'Existing configured zram retained for manual validation.' >&2; exit 1; fi
printf '%s\n' "$expected" > "$unit"
chmod 0644 "$unit"
systemctl daemon-reload
# The unit's --activate path takes this same lock. Release before waiting for its job.
flock -u 9
systemctl enable --now cos-zram.service
zramctl; swapon --show --bytes
