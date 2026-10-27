---
question: "Peut-on placer un CDN devant la diffusion ?"
order: 6
status: available
keywords: ["cdn","cache","cloudflare","fastly","purge","domaine"]
---
Oui, c’est même recommandé. Les URL de diffusion sont versionnées et immuables, sans cookie, avec un cache d’un an pour les médias publics.

Remplacer un fichier crée une nouvelle URL : aucune purge n’est jamais nécessaire. Un domaine dédié aux médias, comme `media.example.com`, se configure en une variable.
