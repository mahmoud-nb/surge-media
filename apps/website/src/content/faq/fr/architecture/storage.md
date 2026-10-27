---
question: "Où sont stockés les fichiers ?"
order: 4
status: available
keywords: ["stockage","s3","minio","r2","scaleway","ovh","disque","bucket"]
---
Sur le disque du serveur (ou un volume partagé), ou dans un stockage objet compatible S3 : AWS S3, Cloudflare R2, MinIO, Scaleway, OVHcloud…

Les objets restent privés : tout passe par surgeMedia, qui applique le contrôle d’accès. Changer de fournisseur revient à copier les fichiers et à modifier la configuration, sans toucher au code ni à la base.
