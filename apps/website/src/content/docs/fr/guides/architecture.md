---
title: Architecture et API
description: Le fonctionnement de SurgeMedia — un back-end média headless avec une API REST et une diffusion par URL, sur votre propre infrastructure — et la façon dont les applications l’utilisent.
---

SurgeMedia sépare **l’endroit où vivent vos médias** de **l’endroit où ils sont utilisés**. C’est un back-end média _headless_ : il n’impose ni front-end, ni gabarit, ni CMS. Vos sites, applications mobiles, back-offices et partenaires consomment les médias en HTTP — depuis une seule instance que vous hébergez, sous votre propre domaine.

## Vue d’ensemble

```text
  Vos applications : sites (dev · préprod · prod), applications mobiles,
  back-offices, chaînes CI/CD, navigateurs et CDN
        │                                      │
        │ API REST v1 (jeton Bearer)           │ GET /m/… (sans cookie, cacheable)
        ▼                                      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │ SurgeMedia — sur votre serveur, sous votre domaine          │
  │   /api/v1   projets, médias, dossiers, jetons, URL signées  │
  │   /m/…      diffusion et transformations à la volée         │
  │   /admin    équipes, rôles, réglages, journal d’audit       │
  │   workers   traitements vidéo FFmpeg, hors des requêtes     │
  └─────────────────────────────────────────────────────────────┘
        │ SQL                                  │ fichiers
        ▼                                      ▼
  SQLite · PostgreSQL · MySQL / MariaDB   Disque local ou bucket compatible S3
```

Par défaut, un seul processus sert tout. Quand le trafic vidéo augmente, le traitement des vidéos passe dans des **processus de travail** dédiés (`docker run … worker`) sans rien changer pour vos applications.

## Les briques

| Concept | Ce que c’est | Pourquoi c’est utile |
| --- | --- | --- |
| **Bibliothèque** | Un espace de médias partagé, géré par les administrateurs. | Éléments de marque, logos, visuels communs — lus par toutes les équipes. |
| **Projet** | L’espace de médias d’une application, d’un produit ou d’un client, avec ses membres, ses clés, ses origines autorisées et sa politique de transformation. | Séparation nette entre applications ; l’unité du contrôle d’accès. |
| **Média** | Une image ou une vidéo, **versionnée** (`v1`, `v2`…). Remplacer le fichier crée une nouvelle version et de nouvelles URL. | Les caches ne servent jamais un fichier périmé, et vous n’avez jamais à purger un CDN. |
| **Dossiers** | Une arborescence dans un projet ou la bibliothèque. | Les éditeurs rangent ; l’API filtre par dossier. |
| **Étiquettes** | Étiquettes globales (communes à tous les espaces) et étiquettes par projet ; les confidentielles restent dans l’administration. | Classement transversal ; l’administration et l’API filtrent par étiquettes (au moins une, ou toutes). |
| **Préréglages** | Des transformations nommées (`card`, `og-image`…) au niveau de l’installation ou du projet. | Changez un format partout en modifiant un seul préréglage. |
| **Identifiants** | Clés de projet, jetons personnels et jetons délégués, chacun avec ses portées. | Chaque requête est attribuable et limitée au strict nécessaire. |

Un média appartient à un seul espace : la bibliothèque ou un projet. Dans l’administration, la page **Médias** réunit pourtant la bibliothèque et tous les projets auxquels vous avez accès : vous y cherchez et filtrez partout à la fois, chaque média indiquant son espace. Pour ranger dans des dossiers, étiqueter en lot ou voir la corbeille, vous ouvrez un espace ; un envoi va toujours dans un espace précis, que vous choisissez.

## Deux plans : gestion et diffusion

### L’API de gestion — `/api/v1`

Une API REST JSON versionnée pour lister, rechercher, envoyer, modifier, ranger et signer les médias.

- **Authentification** par jeton `Bearer` dans l’en-tête `Authorization` — jamais dans l’URL.
- **Portées** par identifiant : `project:read`, `media:read`, `media:upload`, `media:write`, `media:delete`, `tags:manage`.
- **CORS par projet** : seules les origines que vous autorisez (`https://www.acme.fr`, `https://*.acme.fr`) peuvent appeler l’API depuis un navigateur.
- **Prévisible** : pagination par curseur (`limit`, `cursor` → `nextCursor`), `ETag` / `304 Not Modified`, en-têtes `RateLimit`, et erreurs au format `application/problem+json` avec un `code` stable et un `X-Request-Id`.
- **Autodescriptive** : le document OpenAPI 3.1 est servi sur `/api/v1/openapi.json` (`?lang=fr` ou `en`) et le catalogue des erreurs sur `/api/v1/errors`. L’administration propose une référence interactive préremplie avec la clé publique de votre projet.

### Le plan de diffusion — `/m/…`

Chaque média dispose d’URL stables, sans cookie et adaptées aux CDN :

```text
/m/<id>/v<version>/<nom>.<ext>                       l’original
/m/<id>/v<version>/preview/<nom>.webp                un préréglage
/m/<id>/v<version>/w_800,h_450,fit_cover/<nom>.avif  une transformation libre
```

Les médias publics sont servis avec des en-têtes de cache immuables et longue durée : un CDN placé devant SurgeMedia absorbe le trafic. Les médias privés exigent une **URL signée** ou un jeton `Bearer`. Les vidéos acceptent les requêtes HTTP `Range` pour la lecture à un instant donné. Voir la [référence des transformations d’images](../../reference/image-transformations/).

## Les identifiants en un coup d’œil

| Identifiant | Préfixe | Où il vit | Ce qu’il permet |
| --- | --- | --- | --- |
| **Clé publique** | `sm_pk_` | Navigateur, application mobile | Lire les médias publics d’un projet, depuis les origines autorisées uniquement. |
| **Clé secrète** | `sm_sk_` | Vos serveurs, CI/CD | Les portées accordées dans un projet ; échéance, rotation avec chevauchement. Refusée si elle est envoyée depuis un navigateur. |
| **Jeton personnel** | `sm_pat_` | Scripts, migrations | Agit au nom d’un utilisateur sur les projets sélectionnés. |
| **Jeton délégué** | `sm_dt_` | Navigateur, pour quelques minutes | Émis par votre serveur pour un utilisateur et une tâche (par exemple « envoyer 5 JPEG dans ce dossier »). |

Détails et bonnes pratiques : [Sécurité et contrôle d’accès](../security/).

## Exemples concrets

Les exemples ci-dessous utilisent `https://media.example.com` comme instance SurgeMedia et `$PROJECT` comme identifiant de projet.

### 1. Des fiches produit rapides partout

Un site e-commerce liste les photos d’un produit et affiche des images responsives — le même code en développement, en préproduction et en production.

```ts
// Côté serveur (Node, Next.js, Nuxt…) : la clé secrète n’atteint jamais le navigateur.
const res = await fetch(
  `https://media.example.com/api/v1/projects/${PROJECT}/media?q=sneaker-air&kind=image&limit=12`,
  { headers: { Authorization: `Bearer ${process.env.SURGE_MEDIA_SECRET_KEY}` } },
);
const { items } = await res.json();

// Chaque média fournit un modèle d’URL : complétez-le pour chaque taille et chaque format.
const src = (media, transform, format) =>
  media.urlTemplate.replace('{transform}', transform).replace('{format}', format);

const srcset = [400, 800, 1200].map((w) => `${src(items[0], `w_${w}`, 'avif')} ${w}w`).join(', ');
```

**Impact métier :** formats modernes (AVIF, WebP) et images à la bonne taille sans étape de compilation ni CDN d’images payant ; le marketing change les visuels sans déploiement.

### 2. Des envois directs depuis le navigateur, sans relayer les fichiers

Une place de marché permet aux vendeurs d’envoyer leurs photos produit. Votre back-end authentifie le vendeur, puis demande à SurgeMedia un **jeton délégué** limité à ce vendeur et à cette tâche :

```bash
curl -X POST "https://media.example.com/api/v1/projects/$PROJECT/delegated-tokens" \
  -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "scopes": ["media:upload"],
    "subject": "seller-42",
    "origin": "https://vendre.acme.fr",
    "expiresIn": 900,
    "upload": { "maxFiles": 5, "maxSize": 10485760, "types": ["image/jpeg", "image/png", "image/webp"] }
  }'
# → 201 { "token": "sm_dt_…", "expiresAt": "…", "scopes": ["media:upload"] }
```

Le navigateur envoie ensuite directement ses fichiers sur `POST /api/v1/projects/$PROJECT/media` avec ce jeton. Le type de fichier (détecté d’après le contenu, pas l’extension), la taille et le nombre sont vérifiés par SurgeMedia ; le jeton expire seul et devient aussitôt invalide si la clé émettrice est révoquée.

**Impact métier :** aucun trafic d’envoi sur vos serveurs applicatifs, aucun secret durable dans le navigateur, et chaque fichier rattaché au vendeur qui l’a envoyé.

### 3. Des médias privés réservés aux membres

Un portail RH ou un site de contenus premium stocke ses médias en **privé**. Quand un membre ouvre une page, votre serveur demande des liens signés de courte durée — jusqu’à 100 en un seul appel :

```bash
curl -X POST "https://media.example.com/api/v1/projects/$PROJECT/signed-urls" \
  -H "Authorization: Bearer $SURGE_MEDIA_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "expiresIn": 600, "items": [
        { "mediaId": "k7d2m9qz", "preset": "card", "format": "webp" },
        { "mediaId": "p1x8w3rt", "target": "file" } ] }'
```

**Impact métier :** les liens partagés hors du portail cessent de fonctionner au bout de dix minutes ; l’accès reste sous le contrôle de votre propre authentification.

### 4. Une seule médiathèque pour le développement, la préproduction et la production

Chaque environnement d’une application utilise le **même projet** avec ses propres clés, étiquetées `development`, `staging` ou `production`. Les contenus envoyés par les éditeurs en production sont immédiatement disponibles pour les développeurs en préproduction, avec les mêmes identifiants et les mêmes URL. La rotation d’une clé de préproduction n’affecte jamais la production. Voir [Une source de vérité pour tous les environnements](../environments/).

### 5. Des vidéos qui se lisent, tout simplement

Envoyez un MP4 ou un MOV : SurgeMedia place l’index en tête du fichier pour une lecture immédiate, retire les pistes de localisation GPS, extrait une image d’affiche et accepte des sous-titres WebVTT ou SRT. Avec FFmpeg activé, il produit aussi des rendus H.264 et AV1 — renvoyés dans le tableau `sources` du média, prêts pour un élément `<video>`.

## Performances et montée en charge

- **Généré une fois, servi pour toujours** : une transformation s’exécute à la première requête, puis le fichier est conservé et servi avec un cache immuable. Les demandes équivalentes partagent le même fichier.
- **Travail borné** : le traitement des images passe par une file bornée ; sous pression, SurgeMedia répond `503` avec `Retry-After` au lieu de s’effondrer.
- **Traitement vidéo horizontal** : les tâches FFmpeg sont placées dans une file persistante, traitée par un ou plusieurs processus de travail, hors du chemin des requêtes.
- **La base de données de votre choix** : SQLite pour un serveur unique, PostgreSQL ou MySQL / MariaDB pour plusieurs instances derrière un répartiteur de charge.

## Et ensuite ?

- [Installez SurgeMedia](../getting-started/) en quelques minutes.
- [Sécurisez votre intégration](../security/) avec le bon identifiant pour chaque contexte.
- [Choisissez une offre](../../pricing/) — gratuite sous 500 000 USD de chiffre d’affaires annuel.
