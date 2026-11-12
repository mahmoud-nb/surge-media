---
question: "Comment mettre à jour SurgeMedia ?"
order: 5
keywords: ["mise à jour","upgrade","migration","version","semver","changelog","rollback"]
---
Tirez la nouvelle image et recréez les conteneurs : les migrations de la base s’appliquent au démarrage, en quelques secondes. Avec plusieurs instances, lancez la commande `migrate` une fois avant le déploiement.

Les versions suivent SemVer, et chaque changement est décrit dans l’historique des versions. Les migrations ne vont que vers l’avant : faites une sauvegarde avant chaque mise à jour.
