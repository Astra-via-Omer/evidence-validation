#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates python3
if ! id ipfs >/dev/null 2>&1; then useradd --system --home /var/lib/ipfs --shell /usr/sbin/nologin ipfs; fi
install -d -o ipfs -g ipfs -m 700 /var/lib/ipfs
if [ ! -f /swapfile ]; then fallocate -l 1G /swapfile; chmod 600 /swapfile; mkswap /swapfile; fi
swapon /swapfile 2>/dev/null || true
grep -q '^/swapfile ' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
if [ ! -x /usr/local/bin/ipfs ]; then
  task_tmp=$(mktemp -d)
  curl -fsSL --retry 3 https://github.com/ipfs/kubo/releases/download/v0.43.1/kubo_v0.43.1_linux-amd64.tar.gz -o "$task_tmp/kubo_v0.43.1_linux-amd64.tar.gz"
  curl -fsSL --retry 3 https://github.com/ipfs/kubo/releases/download/v0.43.1/kubo_v0.43.1_linux-amd64.tar.gz.sha512 -o "$task_tmp/checksum"
  (cd "$task_tmp"; sha512sum -c checksum; tar xzf kubo_v0.43.1_linux-amd64.tar.gz)
  install -m 755 "$task_tmp/kubo/ipfs" /usr/local/bin/ipfs
  rm -rf "$task_tmp"
fi
ipfs_config() { runuser -u ipfs -- env IPFS_PATH=/var/lib/ipfs /usr/local/bin/ipfs "$@"; }
if [ ! -f /var/lib/ipfs/config ]; then ipfs_config init --profile=lowpower; fi
ipfs_config config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs_config config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
ipfs_config config Datastore.StorageMax 5GB
ipfs_config config --json Swarm.ConnMgr.LowWater 20
ipfs_config config --json Swarm.ConnMgr.HighWater 40
ipfs_config config Routing.Type dhtclient
cat > /etc/systemd/system/astra-ipfs.service <<'UNIT'
[Unit]
Description=Astra-Via hosted IPFS Kubo node
After=network-online.target
Wants=network-online.target
[Service]
User=ipfs
Group=ipfs
Environment=IPFS_PATH=/var/lib/ipfs
Environment=GOMEMLIMIT=550MiB
ExecStart=/usr/local/bin/ipfs daemon --enable-gc
Restart=on-failure
RestartSec=5
TimeoutStopSec=90
MemoryHigh=650M
MemoryMax=800M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/ipfs
[Install]
WantedBy=multi-user.target
UNIT
cat > /usr/local/sbin/astra-ipfs-backup <<'BACKUP'
#!/bin/bash
set -euo pipefail
exec 9>/run/astra-ipfs-backup.lock
flock -n 9 || exit 0
archive=$(mktemp /var/tmp/astra-ipfs-backup.XXXXXX.tar.gz)
cleanup() { systemctl start astra-ipfs; if systemctl cat astra-ipfs-bridge >/dev/null 2>&1; then systemctl start astra-ipfs-bridge; fi; rm -f "$archive"; }
trap cleanup EXIT
if systemctl cat astra-ipfs-bridge >/dev/null 2>&1; then systemctl stop astra-ipfs-bridge; fi
systemctl stop astra-ipfs
backup_dirs=(ipfs)
if [ -d /var/lib/ipfs-publications ]; then backup_dirs+=(ipfs-publications); fi
tar --exclude=repo.lock --exclude=api -C /var/lib -czf "$archive" "${backup_dirs[@]}"
systemctl start astra-ipfs
if systemctl cat astra-ipfs-bridge >/dev/null 2>&1; then systemctl start astra-ipfs-bridge; fi
backup_token=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
backup_name="node-backups/$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
curl -fsS --retry 2 -X POST -H "Authorization: Bearer $backup_token" -H 'Content-Type: application/gzip' --data-binary "@$archive" "https://storage.googleapis.com/upload/storage/v1/b/astra-via-ipfs-backups-418893440067/o?uploadType=media&name=$backup_name" > /dev/null
printf 'IPFS backup uploaded: %s\n' "$backup_name"
BACKUP
chmod 700 /usr/local/sbin/astra-ipfs-backup
cat > /etc/systemd/system/astra-ipfs-backup.service <<'UNIT'
[Unit]
Description=Back up hosted IPFS repository to private Google Cloud Storage
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/astra-ipfs-backup
UNIT
cat > /etc/systemd/system/astra-ipfs-backup.timer <<'UNIT'
[Unit]
Description=Daily private IPFS backup
[Timer]
OnCalendar=*-*-* 03:00:00 UTC
RandomizedDelaySec=600
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now astra-ipfs astra-ipfs-backup.timer
