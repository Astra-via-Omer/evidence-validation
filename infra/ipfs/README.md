# Hosted Astra-Via IPFS node

Provisioned in Google Cloud project `astra-via`, independent of an operator's computer.

- VM: `astra-ipfs-node`, `us-central1-a`, `e2-micro`, Debian 12.
- Disk: 30 GB `pd-standard` boot disk, preserved if the VM is deleted. IPFS repository: `/var/lib/ipfs`, owned by the dedicated `ipfs` OS user. Kubo datastore target: 5 GB, leaving capacity for the OS, swap and backup staging.
- Kubo: v0.43.1 official release, SHA-512 verified. `astra-ipfs.service` starts on boot and restarts on failure; low-power/client routing and 20/40 peer connection targets limit overhead. MemoryMax 800 MB; 1 GB swap.
- Network: Astra VPC, `astra-ipfs-subnet` (`10.21.0.0/24`), public swarm TCP/UDP 4001. Administration API 5001 and read gateway 8080 bind to loopback. SSH uses Google IAP and OS Login.
- Backup bucket: `gs://astra-via-ipfs-backups-418893440067`, regional Standard storage in `us-central1`, uniform access, public access prevention, no grants to project viewers. Node identity has only `storage.objectCreator` on this bucket.
- Daily `astra-ipfs-backup.timer`: approximately 03:00 UTC; stops Kubo for a consistent archive, restarts before upload, uploads the archive to private Cloud Storage, removes local staging. Repository backups include the node identity and must remain private. Lifecycle deletes objects after 14 days; Cloud Storage's soft-delete policy also applies.

## Cost

The e2-micro hours and 30 GB standard disk are eligible for the shared billing-account Free Tier in this region, subject to remaining allowances. Public IPv4 is $0.005/hour (~$3.65 for 730 hours). IPFS network traffic can exceed the 1 GB/month Compute Engine outbound allowance even without app uploads. Backup bytes and operations are usage-based; the GCS Free Tier includes 5 GB-months in eligible US regions, shared across the account. No NAT, new load balancer, or public gateway is provisioned.

This is a small single-node pilot, not high availability or independent replicated pinning. Cloud Storage backups are recovery copies, not IPFS peers or pins.

## Operations

Always explicitly select project and account; never change an operator's global gcloud defaults.

```sh
gcloud compute ssh astra-ipfs-node --zone=us-central1-a --tunnel-through-iap --project=astra-via --account=omer@astra-via.com
sudo systemctl status astra-ipfs
sudo -u ipfs env IPFS_PATH=/var/lib/ipfs ipfs swarm peers
sudo -u ipfs env IPFS_PATH=/var/lib/ipfs ipfs pin ls
sudo /usr/local/sbin/astra-ipfs-backup
```

For recovery, an authorized operator downloads a selected private archive to the VM, stops `astra-ipfs`, restores the archive's `ipfs/` directory beneath `/var/lib`, restores ownership to `ipfs:ipfs`, and starts the service. Never extract or display the repository's private identity in logs. Test restore in a separate temporary directory before replacing an active repository.

`startup.sh` is the installed VM startup metadata script. The service is not yet connected to Evidence Validation publication, its storage UI, an Astra subdomain, or paid/ledger settlement. Do not expose Kubo RPC as a public dashboard. A subsequent integration must provide authenticated application-level operations and keep the node API private.
