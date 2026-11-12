---
title: Rôles et responsabilités
description: Rôles de plateforme (Administrateur, Gestionnaire, Développeur, Éditeur) et rôles de projet (Propriétaire, Développeur, Éditeur) — qui peut faire quoi dans SurgeMedia.
---

SurgeMedia distingue deux niveaux de rôles : un **rôle de plateforme** pour chaque utilisateur, et un **rôle de projet** pour chaque projet dont il est membre. Ensemble, ils donnent à chacun exactement les accès dont il a besoin — et rien de plus.

## Rôles de plateforme

| <span class="sr-only">Permission</span> | Administrateur | Gestionnaire | Développeur | Éditeur |
| --- | :---: | :---: | :---: | :---: |
| Lire la bibliothèque partagée | ✓ | ✓ | ✓ | ✓ |
| Gérer la bibliothèque partagée | ✓ | | | |
| Créer des projets | ✓ | ✓ | | |
| Accéder à tous les projets | ✓ | | | |
| Inviter des utilisateurs | ✓ (tous rôles) | ✓ (développeurs, éditeurs) | | |
| Gérer tous les comptes | ✓ | | | |
| Jetons personnels | ✓ | ✓ | ✓ | |
| Documentation interactive de l’API | ✓ | ✓ | ✓ | |
| Étiquettes globales (bibliothèque et tous les projets) | ✓ | | | |
| Étiquettes confidentielles | ✓ | ✓ | | |
| Journal d’audit | ✓ | | | |
| Réglages de l’installation (transformations, vidéo) | ✓ | | | |

- **Administrateur** — pilote la plateforme : utilisateurs, bibliothèque, réglages, audit. Il est propriétaire de tous les projets.
- **Gestionnaire** — pilote ses projets et ses équipes : crée des projets, invite des développeurs et des éditeurs, et est toujours propriétaire des projets dont il est membre.
- **Développeur** — intègre : clés d’API, origines et médias des projets dont il est membre.
- **Éditeur** — le rôle par défaut, au moindre privilège : envoie, range et décrit les médias.

## Rôles de projet

| <span class="sr-only">Permission</span> | Propriétaire | Développeur | Éditeur |
| --- | :---: | :---: | :---: |
| Lire, envoyer, modifier et supprimer des médias | ✓ | ✓ | ✓ |
| Clés d’API et origines autorisées | ✓ | ✓ | |
| Affecter des étiquettes aux médias | ✓ | ✓ | ✓ |
| Étiquettes du projet (créer, renommer, supprimer) | ✓ | | |
| Membres | ✓ | | |
| Réglages du projet, politique et préréglages de transformation, archivage | ✓ | | |

Le rôle de plateforme fixe le **plafond** du rôle de projet : un Éditeur reste Éditeur dans ses projets, un Développeur est au plus Développeur, tandis qu’Administrateurs et Gestionnaires agissent en Propriétaires. Un utilisateur qui n’est pas membre d’un projet ne le voit pas du tout.

## Organisations types

- **Équipe interne** — un Administrateur à la DSI, un Gestionnaire par gamme de produits, des Développeurs sur le projet de chaque produit, des Éditeurs au marketing.
- **Agence** — l’Administrateur de l’agence, un projet par client, les équipes du client invitées comme Éditeurs sur leur seul projet.
- **Groupe multimarque** — les éléments de marque communs dans la bibliothèque (lue par tous), un projet par marque ou par site.

## Voir aussi

- [Sécurité et contrôle d’accès](../security/)
- [Une source de vérité pour tous les environnements](../environments/)
