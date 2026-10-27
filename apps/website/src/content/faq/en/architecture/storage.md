---
question: "Where are the files stored?"
order: 4
status: available
keywords: ["storage","s3","minio","r2","scaleway","ovh","disk","bucket"]
---
On the server's disk (or a shared volume), or in S3-compatible object storage: AWS S3, Cloudflare R2, MinIO, Scaleway, OVHcloud…

Objects stay private: everything goes through surgeMedia, which enforces access control. Switching providers means copying the files and changing the configuration, without touching the code or the database.
