---
question: "Comment essayer SurgeMedia ?"
order: 6
keywords: ["installer","essai","démarrage","docker","npm","gratuit","évaluation","démo"]
related:
  - label: "Guide de démarrage"
    href: "/guides/getting-started/"
---
Sans rien installer, sur la [démo publique](https://demo.usesurgemedia.com) : sa page de connexion donne deux comptes partagés (administrateur et éditeur), et tout est remis à zéro toutes les deux heures : n’y envoyez rien de personnel.

Sur vos serveurs, en quelques minutes, avec Docker ou npm. C’est gratuit pour le développement, les tests et l’évaluation, sans clé de licence ni limite de durée :

```bash
docker run -d -p 3000:3000 -v surge-media-data:/app/data ghcr.io/mahmoud-nb/surge-media
```

Le [guide de démarrage](../guides/getting-started/) détaille l’installation, la création du premier compte et le premier envoi.
