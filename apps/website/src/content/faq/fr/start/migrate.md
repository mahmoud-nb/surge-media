---
question: "Comment reprendre mes médias existants ?"
order: 7
status: available
keywords: ["migration","import","reprise","médias existants","s3","bucket","uploads","cloudinary","imgix","redirection","réécriture des url"]
related:
  - label: "Migrer vers SurgeMedia"
    href: "/guides/migrating/"
---
Avec la commande `surge-media import`, incluse gratuitement. Elle lit vos fichiers dans un dossier, un bucket S3 (AWS, R2, MinIO, Scaleway…) ou une liste d’URL exportée de votre base, et les envoie dans un projet par l’API : mêmes contrôles, mêmes aperçus, même traitement vidéo que n’importe quel envoi.

L’import est reprenable et ne crée jamais deux fois le même média. Il écrit une table de correspondance (ancienne adresse → identifiant du média → nouvelle URL) pour réécrire les URL de votre base, et peut produire les redirections 301 des anciennes adresses pour nginx, Caddy, Apache ou Cloudflare. Les fichiers sont copiés, jamais déplacés : votre ancien stockage reste intact jusqu’à ce que vous décidiez de le supprimer.
