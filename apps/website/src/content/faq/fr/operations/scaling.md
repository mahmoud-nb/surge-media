---
question: "Comment monter en charge et assurer la haute disponibilité ?"
order: 3
status: partial
keywords: ["montée en charge","scalabilité","haute disponibilité","répartiteur","cluster","redis","workers"]
---
Placez d’abord un CDN devant la diffusion : il absorbe l’essentiel du trafic. Ajoutez ensuite des instances web derrière un répartiteur de charge, avec PostgreSQL ou MySQL et un stockage S3 ; les instances sont interchangeables. Le traitement vidéo passe à l’échelle avec des processus de travail supplémentaires, qui se partagent une file persistante.

Les limites de débit et les caches sont aujourd’hui propres à chaque instance ; un cache partagé (Redis) est prévu.
