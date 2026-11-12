---
question: "Does SurgeMedia run on Kubernetes?"
order: 5
status: partial
keywords: ["kubernetes","k8s","helm","orchestrator","container","probe"]
---
Yes. The image is configured entirely through environment variables, exposes a health probe (`/api/health`) and shuts down cleanly on `SIGTERM`.

The recommended layout: a *Job* that applies the migrations, a web *Deployment* with several replicas and a worker *Deployment*. We do not provide a Helm chart yet.
