---
title: Sécurité et contrôle d’accès
description: Identifiants, portées, origines autorisées, URL signées, politiques de transformation et journal d’audit — comment SurgeMedia garde vos médias et votre API sous contrôle.
---

SurgeMedia est conçu pour que **chaque requête soit attribuable et limitée au strict nécessaire**. Les responsables de projet gèrent eux-mêmes les accès depuis l’administration, sans toucher à la configuration du serveur.

## Identifiants

Chaque identifiant appartient à un projet (ou à un utilisateur, pour les jetons personnels), porte des **portées**, et peut être révoqué à tout moment — avec effet immédiat.

| Identifiant | Préfixe | À utiliser pour | À ne jamais utiliser pour |
| --- | --- | --- | --- |
| **Clé publique** | `sm_pk_` | Navigateurs et applications mobiles qui lisent les médias **publics** d’un projet. | Écrire, lire des médias privés, signer des URL. |
| **Clé secrète** | `sm_sk_` | Vos serveurs, la CI/CD, les intégrations de back-office. | Les navigateurs : SurgeMedia **refuse** une clé secrète envoyée depuis une page web (`SECRET_IN_BROWSER`). |
| **Jeton personnel** | `sm_pat_` | Scripts et migrations au nom d’un utilisateur, sur des projets choisis. | Les services de production durables (utilisez une clé secrète). |
| **Jeton délégué** | `sm_dt_` | Une tâche dans le navigateur, pour quelques minutes : envoi, sélecteur, médiathèque. | Tout usage durable : il expire au bout d’une heure au plus. |

Les jetons sont toujours envoyés dans l’en-tête `Authorization: Bearer …`. Un jeton dans l’URL est refusé, pour qu’il ne finisse jamais dans des journaux ou l’historique du navigateur. Chaque jeton contient une somme de contrôle : un jeton mal recopié ou tronqué est rejeté sans consulter la base de données.

### Portées

| Portée | Permet |
| --- | --- |
| `project:read`, `media:read` | Lire le projet et ses médias (toujours incluses). |
| `media:upload` | Envoyer de nouveaux médias. |
| `media:write` | Modifier les métadonnées, le point d’intérêt, les dossiers et les étiquettes ; remplacer les fichiers. |
| `media:delete` | Placer des médias à la corbeille. |
| `tags:manage` | Créer, renommer et supprimer les étiquettes du projet (facultative ; une clé secrète ne la reçoit que si la personne qui la crée la détient). |

Les identifiants n’obtiennent jamais d’autres portées de gestion : membres, clés et réglages ne se gèrent que depuis l’administration, par des personnes. Les étiquettes globales ne se gèrent que depuis l’administration, et les **étiquettes confidentielles** n’apparaissent jamais dans l’API, quel que soit l’identifiant : seuls les administrateurs et les gestionnaires les voient, dans l’administration. Un jeton délégué n’obtient jamais `tags:manage`.

### Cycle de vie

- **Échéance** : les clés secrètes durent 30, 90 ou 365 jours, ou n’expirent jamais — selon votre politique.
- **Rotation** : une nouvelle clé remplace l’ancienne avec le même nom, le même environnement et les mêmes portées ; l’ancienne peut continuer à fonctionner pendant une **période de chevauchement**, le temps de déployer.
- **Révocation** : immédiate, elle invalide aussi tous les jetons délégués émis par la clé.
- **Environnements** : chaque clé porte une étiquette d’environnement (`production`, `staging`, `development`…), affichée et regroupée dans l’administration.

## Origines autorisées (CORS)

Chaque projet liste les origines autorisées à appeler son API depuis un navigateur : `https://www.acme.fr`, ou un joker comme `https://*.acme.fr`. Les requêtes venant de toute autre origine sont refusées (`ORIGIN_NOT_ALLOWED`). Un jeton délégué peut être limité à une origine exacte.

## Envois directs avec les jetons délégués

Votre serveur authentifie **son** utilisateur, puis demande à SurgeMedia un jeton délégué :

- des portées incluses dans les portées **actuelles** de la clé émettrice ;
- une durée de 1 à 60 minutes (15 par défaut), jamais au-delà de l’échéance de la clé émettrice ;
- des contraintes d’envoi vérifiées côté serveur : nombre maximal de fichiers, taille maximale, types acceptés (détectés d’après le contenu du fichier), visibilité et dossier imposés ;
- un `subject` (l’identifiant de votre utilisateur), enregistré sur chaque média qu’il envoie.

Le jeton est sans état et signé (HMAC-SHA256). Révoquer la clé émettrice l’invalide instantanément.

## Médias privés et URL signées

Chaque média est **public** ou **privé**.

- Les médias publics sont servis à quiconque possède l’URL, avec des en-têtes de cache immuables.
- Les médias privés ne sont servis qu’avec une **URL signée** valide (HMAC, avec échéance) ou un jeton `Bearer`. Votre serveur demande des URL signées une par une ou par lots de 100, pour un fichier, un préréglage ou une transformation précis.
- Les clés de signature peuvent tourner : les liens signés avec la clé précédente continuent de fonctionner pendant la transition.

## Politiques de transformation

Pour maîtriser ce qui peut être généré sur vos serveurs, chaque projet (et la bibliothèque partagée) a une politique :

| Politique | Transformations libres dans les URL | Usage type |
| --- | --- | --- |
| `OPEN` (par défaut) | Acceptées, dans les limites | Sites publics qui construisent leurs `srcset` côté client. |
| `SIGNED` | Seulement avec une URL signée ou un identifiant d’API | Installations exposées à fort trafic. |
| `PRESETS` | Refusées — préréglages nommés uniquement | Contrôle exact des fichiers générés. |

Dans tous les cas, les sorties sont plafonnées (4 096 px par défaut), les images ne sont jamais agrandies, le nombre de variantes par version de média est limité et les générations non signées sont limitées par adresse IP.

## Comptes et sessions

- Mots de passe hachés avec **argon2id** ; sessions stockées côté serveur et révocables par un administrateur.
- **Double authentification (TOTP)** : chaque compte l’active depuis **Mon compte** avec n’importe quelle application d’authentification et reçoit dix codes de secours à usage unique. Les administrateurs peuvent l’exiger des administrateurs ou de tous (**Réglages › Sécurité**). Les secrets sont chiffrés en base ; chaque changement est inscrit au journal d’audit et signalé par e-mail au titulaire du compte. L’exploitant du serveur peut la réinitialiser en ligne de commande (`surge-media user mfa-reset`).
- **Mode sudo** : créer une clé secrète ou un jeton personnel, ou modifier les membres d’un projet, redemande le mot de passe (valable 10 minutes). Les utilisateurs peuvent déclarer un appareil de confiance.
- La connexion et la confirmation du mot de passe sont limitées en débit ; les échecs répétés bloquent temporairement les nouvelles tentatives.
- Les invitations et réinitialisations de mot de passe passent par des liens à usage unique et à durée limitée.

## Journal d’audit

Les administrateurs disposent d’un **journal d’audit** filtrable des actions sensibles — changements de projets et de membres, création, rotation et révocation des clés et jetons, réglages des transformations, changements de visibilité des médias, déplacements et suppressions définitives — avec l’auteur, le projet, l’identifiant utilisé et le contexte. Les médias envoyés par l’API conservent la trace de l’identifiant et de l’utilisateur final (`subject`) qui les a envoyés.

## Limites de débit et résilience

- Des limites de requêtes par identifiant avec les en-têtes standard `RateLimit`, et une limite dédiée aux envois.
- Les authentifications échouées sont comptées par adresse IP ; au-delà du seuil, l’adresse est temporairement bloquée sur l’API.
- Les corps de requête sont limités en taille et en durée ; les envois bloqués sans donnée sont interrompus.
- Derrière un mandataire inverse, `NUXT_TRUST_PROXY` permet aux limites et aux journaux d’utiliser la vraie adresse IP du client.

## Chaîne d’approvisionnement

- Les dépendances sont auditées à chaque modification, chaque lundi et avant chaque version, et l’image Docker est analysée avant d’être publiée : une faille élevée ou critique dans ce qui est livré bloque la publication, sauf exception écrite et limitée dans le temps qui explique pourquoi elle ne s’applique pas.
- Les GitHub Actions tierces sont épinglées par empreinte de commit, les nouveaux commits sont examinés à la recherche de secrets, et les workflows de publication ne partagent aucun cache de build avec les autres.
- Chaque version est accompagnée de SBOM (images et paquet npm) et d’empreintes. Les vérifier : la [politique de sécurité](https://github.com/mahmoud-nb/surge-media/blob/main/SECURITY.md#supply-chain).

## Voir aussi

- [Rôles et responsabilités](../roles/)
- [Architecture et API](../architecture/)
