---
question: "Comment les clés d’API sont-elles protégées ?"
order: 4
status: available
keywords: ["clé d’api","jeton","token","secret","rotation","révocation","portée","scope"]
related:
  - label: "Sécurité et contrôle d’accès"
    href: "/guides/security/"
---
Chaque clé appartient à un projet, porte des portées limitées, et peut expirer, tourner avec une période de chevauchement ou être révoquée immédiatement. SurgeMedia n’en conserve que l’empreinte et n’affiche la valeur qu’une seule fois.

Une clé secrète envoyée depuis un navigateur est refusée, et chaque clé porte un préfixe et une somme de contrôle qui facilitent la détection des fuites.
