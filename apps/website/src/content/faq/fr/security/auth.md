---
question: "Comment les utilisateurs s’authentifient-ils ?"
order: 2
status: available
keywords: ["authentification","connexion","mot de passe","argon2","session","sudo","invitation"]
related:
  - label: "Rôles et responsabilités"
    href: "/guides/roles/"
---
Par e-mail et mot de passe, sur des comptes créés par invitation : il n’y a pas d’inscription publique. Les mots de passe sont hachés en argon2id, et les sessions sont stockées côté serveur et révocables à tout moment.

Les actions sensibles, comme créer une clé secrète ou modifier les membres d’un projet, redemandent le mot de passe, et les tentatives de connexion sont limitées.
