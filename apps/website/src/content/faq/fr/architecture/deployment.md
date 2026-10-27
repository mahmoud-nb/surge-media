---
question: "Quels modèles de déploiement sont possibles ?"
order: 2
status: available
keywords: ["déploiement","docker","compose","haute disponibilité","arm64","image"]
---
- **Serveur unique** : un conteneur, SQLite et le disque local, idéal pour démarrer.
- **Serveur et processus de travail** : PostgreSQL, un serveur web et un processus de travail vidéo ; un exemple Docker Compose est fourni.
- **Haute disponibilité** : plusieurs instances derrière un répartiteur de charge, PostgreSQL ou MySQL, un stockage S3, des processus de travail et un CDN.

L’image Docker existe pour amd64 et arm64, en variante complète (avec FFmpeg) ou allégée.
