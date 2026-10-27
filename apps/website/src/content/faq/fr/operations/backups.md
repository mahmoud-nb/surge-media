---
question: "Que faut-il sauvegarder ?"
order: 4
keywords: ["sauvegarde","backup","restauration","pra","rpo","rto","reprise"]
---
Trois éléments, ensemble : la base de données, le stockage des médias et les deux secrets de l’application (sessions et signature des liens).

Utilisez vos outils habituels : `pg_dump` ou une sauvegarde continue, versionnage et réplication du bucket S3. Après une restauration, toutes les URL de médias restent identiques : aucune intégration n’est à reconfigurer.
