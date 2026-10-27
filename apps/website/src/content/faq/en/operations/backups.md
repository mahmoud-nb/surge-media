---
question: "What should I back up?"
order: 4
keywords: ["backup","restore","disaster recovery","rpo","rto"]
---
Three things, together: the database, the media storage and the application's two secrets (sessions and link signing).

Use your usual tools: `pg_dump` or continuous backups, S3 bucket versioning and replication. After a restore, every media URL stays the same: no integration needs to be reconfigured.
