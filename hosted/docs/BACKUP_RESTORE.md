# Backup and restore

Create a backup from inside the container or with the data volume mounted:

```bash
node scripts/backup.js /data/backup-YYYYMMDD.sqlite
```

Restore only while the service is stopped
1. Stop the container
2. Keep the current database as a rollback copy
3. Copy the selected backup to `/data/commerce.sqlite`
4. Preserve owner/permissions
5. Start the service and verify `/healthz`, API-key lookup and usage counts

Never restore a database from an untrusted source
