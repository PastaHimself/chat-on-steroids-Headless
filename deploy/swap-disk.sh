#!/usr/bin/env bash
# Optional managed 4 GiB disk swap. Existing swap and unrelated fstab rows are preserved.
set -euo pipefail
swapfile=/var/lib/cos-swap/swapfile
line="$swapfile none swap sw,pri=10 0 0 # COS-MANAGED-SWAP"
if [[ "${1:-}" = '--check' ]]; then
  swapon --show --bytes
  findmnt --noheadings --output FSTYPE --target /var/lib
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo 'Run optional swap setup with sudo.' >&2; exit 1; }
exec 9>/run/lock/cos-disk-swap.lock; flock -x 9
[[ ! -L /var/lib/cos-swap && ! -L "$swapfile" && ! -L /etc/fstab ]] || { echo 'Refusing linked swap paths or fstab.' >&2; exit 1; }
if [[ -e /var/lib/cos-swap ]]; then
  [[ -d /var/lib/cos-swap && $(stat -c%u /var/lib/cos-swap) = 0 && $(stat -c%a /var/lib/cos-swap) = 700 ]] || { echo 'Existing swap directory must be private and root-owned; retained for manual validation.' >&2; exit 1; }
fi
if [[ -e "$swapfile" ]]; then
  [[ -f "$swapfile" && $(stat -c%u "$swapfile") = 0 && $(stat -c%a "$swapfile") = 600 && $(stat -c%s "$swapfile") = 4294967296 && $(blkid -p -s LABEL -o value "$swapfile") = COS-DISK-SWAP ]] || { echo 'Existing swap file is not this private managed 4 GiB file; retained for manual validation.' >&2; exit 1; }
fi
while IFS= read -r row; do
  [[ "$row" = "$line" ]] || { echo 'An existing fstab row names this path; retained for manual validation.' >&2; exit 1; }
done < <(awk -v p="$swapfile" '$1 == p { print }' /etc/fstab)
if [[ "${1:-}" = '--rollback' ]]; then
  [[ -f "$swapfile" ]] || exit 0
  used=$(swapon --noheadings --bytes --show=NAME,USED | awk -v p="$swapfile" '$1 == p { print $2 }')
  available=$(awk '/^MemAvailable:/ { print $2 * 1024 }' /proc/meminfo)
  [[ -z "$used" || $(awk -v a="$available" -v u="$used" 'BEGIN { print a > u + 536870912 ? 1 : 0 }') = 1 ]] || { echo 'Insufficient free RAM for safe swapoff; stop idle workloads and retry rollback.' >&2; exit 1; }
  [[ -z "$used" ]] || swapoff "$swapfile"
  backup="/etc/fstab.cos-backup-$(date +%Y%m%d%H%M%S)"; cp -a /etc/fstab "$backup"
  temp=$(mktemp /etc/fstab.cos.XXXXXX)
  awk -v exact="$line" '$0 != exact' /etc/fstab > "$temp"
  chmod --reference=/etc/fstab "$temp"; chown --reference=/etc/fstab "$temp"; mv "$temp" /etc/fstab
  rm "$swapfile"; rmdir /var/lib/cos-swap
  echo 'Managed disk swap removed; unrelated swap and fstab settings retained.'
  exit 0
fi
[[ "${1:-}" = '' ]] || { echo 'Supported options: --check, --rollback' >&2; exit 1; }
[[ $(findmnt --noheadings --output FSTYPE --target /var/lib) = ext4 ]] || { echo 'This safe helper supports ext4 only. Btrfs, XFS and other filesystems need a separately validated swapfile procedure.' >&2; exit 1; }
if [[ ! -e "$swapfile" ]]; then
  available=$(df --output=avail -B1 /var/lib | tail -1 | tr -d ' ')
  [[ $available -ge 5368709120 ]] || { echo 'At least 5 GiB free disk space is required.' >&2; exit 1; }
  install -d -m 0700 /var/lib/cos-swap
  temp=$(mktemp /var/lib/cos-swap/.swapfile.XXXXXX)
  trap 'rm -f "$temp"' EXIT
  dd if=/dev/zero of="$temp" bs=1M count=4096 conv=fsync status=progress
  chmod 0600 "$temp"; mkswap -L COS-DISK-SWAP "$temp"; mv "$temp" "$swapfile"
fi
active_priority=$(swapon --noheadings --show=NAME,PRIO | awk -v p="$swapfile" '$1 == p { print $2 }')
if [[ -n "$active_priority" ]]; then
  [[ "$active_priority" = 10 ]] || { echo 'Existing managed swap has a different active priority; validate it locally before changing it.' >&2; exit 1; }
else swapon --priority 10 "$swapfile"; fi
if ! grep -Fxq "$line" /etc/fstab; then
  cp -a /etc/fstab "/etc/fstab.cos-backup-$(date +%Y%m%d%H%M%S)"
  printf '\n%s\n' "$line" >> /etc/fstab
fi
swapon --show --bytes
