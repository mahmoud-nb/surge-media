---
question: "Which deployment models are supported?"
order: 2
status: available
keywords: ["deployment","docker","compose","high availability","arm64","image"]
---
- **Single server**: one container, SQLite and the local disk, ideal to get started.
- **Server and worker**: PostgreSQL, a web server and a video worker; a Docker Compose example is provided.
- **High availability**: several instances behind a load balancer, PostgreSQL or MySQL, S3 storage, workers and a CDN.

The Docker image is available for amd64 and arm64, as a full variant (with FFmpeg) or a slim one.
