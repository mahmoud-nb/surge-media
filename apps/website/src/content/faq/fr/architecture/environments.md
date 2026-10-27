---
question: "Comment gérer le développement, la préproduction et la production ?"
order: 7
status: available
keywords: ["environnement","préproduction","staging","développement","production","clés"]
related:
  - label: "Environnements"
    href: "/guides/environments/"
---
Tous vos environnements peuvent lire le **même projet**, chacun avec ses propres clés d’API, étiquetées par environnement, et ses propres origines autorisées.

Les contenus envoyés en production sont aussitôt visibles en préproduction, sans copie de fichiers, et la rotation d’une clé de préproduction n’affecte jamais la production. Un projet séparé reste possible pour les tests destructifs.
