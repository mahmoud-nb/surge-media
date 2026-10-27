---
question: "Comment superviser une instance ?"
order: 6
status: partial
keywords: ["supervision","monitoring","healthcheck","sonde","métriques","prometheus","logs","alertes"]
---
La sonde `/api/health` vérifie la base, le stockage et le traitement d’images, et indique l’état de la file vidéo ; l’image Docker s’en sert comme `HEALTHCHECK`. Les journaux sortent sur la sortie standard.

Le tableau de bord de l’administration signale les points d’attention : clés qui expirent, base SQLite sous pression, traitement vidéo arrêté. Un export de métriques Prometheus est prévu.
