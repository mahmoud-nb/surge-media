---
question: "How do I monitor an instance?"
order: 6
status: partial
keywords: ["monitoring","healthcheck","probe","metrics","prometheus","logs","alerts"]
---
The `/api/health` probe checks the database, the storage and image processing, and reports the state of the video queue; the Docker image uses it as its `HEALTHCHECK`. Logs go to standard output.

The administration dashboard highlights what needs attention: expiring keys, an SQLite database under pressure, stopped video processing. A Prometheus metrics export is planned.
