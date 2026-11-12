---
question: "SurgeMedia fonctionne-t-il sur Kubernetes ?"
order: 5
status: partial
keywords: ["kubernetes","k8s","helm","orchestrateur","conteneur","sonde"]
---
Oui. L’image se configure entièrement par variables d’environnement, expose une sonde de santé (`/api/health`) et s’arrête proprement sur `SIGTERM`.

Le schéma recommandé : un *Job* qui applique les migrations, un *Deployment* web à plusieurs réplicas et un *Deployment* de processus de travail. Nous ne fournissons pas encore de chart Helm.
