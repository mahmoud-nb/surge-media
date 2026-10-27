---
question: "Comment surgeMedia fonctionne-t-il ?"
order: 1
keywords: ["architecture","fonctionnement","composants","admin","api","diffusion","worker"]
related:
  - label: "Architecture et API"
    href: "/guides/architecture/"
---
Une seule application Node.js expose trois surfaces :

- `/admin` : l’interface des équipes (médias, projets, comptes, réglages) ;
- `/api/v1` : l’API REST des applications, authentifiée par jeton ;
- `/m/…` : la diffusion des originaux et des transformations, sans cookie et prête pour un CDN.

Les conversions vidéo tournent dans des processus de travail séparés, lancés depuis la même image. Tout l’état vit dans votre base SQL et votre stockage : les instances sont interchangeables.
