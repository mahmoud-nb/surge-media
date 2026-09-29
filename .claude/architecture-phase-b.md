# Phase B — Projets, médias, jetons d'accès et cache

> **Statut : VALIDÉE — révision 2 (2026-09-29), toutes les décisions D1–D15 confirmées par l'utilisateur.**
> Référence d'implémentation de la phase B. Avancement : **B1 réalisée** (voir `setup.md`, Journal, étape 5, et
> `.claude/project-context.md`) ; prochaine sous-étape : **B2**.
>
> Écarts de B1 par rapport à ce document (à connaître pour la suite) :
> - les **liens signés v2** (§ 4.6 : `kid`, droit élargi, échéance alignée) et `Access-Control-Allow-Origin: *` sur `/m/`
>   ont été faits dès B1 (nécessaires aux aperçus d'administration sans cookie) ; les liens v1 **ne sont plus reconnus**
>   (aucun n'était publié) ;
> - la permission de plateforme de la bibliothèque s'appelle `library:manage` (elle donne les portées `media:*` sur la
>   bibliothèque) ; le PAT (`includeLibrary`) s'appuiera dessus ;
> - la duplication s'appelle aussi dans l'administration (`POST /api/admin/media/:id/duplicate` et `/move`) ; la route
>   équivalente de l'API v1 reste prévue en B4 ;
> - les colonnes `searchTitle/searchName/searchAlt`, `uploadedByTokenId`, `uploadSubject` et les tables de B2–B4
>   (`AccessTokenProject`, `DelegatedTokenUsage`, `CacheRevision`, `AuditEvent`) ne sont **pas** encore créées ;
>   `Project.publicListing` non plus (B3).

## 0. Révision 2 — ce qui a changé après les remarques de l'utilisateur

- **Plus de médias partagés** : chaque média appartient à **un seul espace** (la bibliothèque de l'organisation *ou*
  un projet). La réutilisation passe par la **duplication** (copie indépendante). Les règles de partage (R3 « tous les
  rattachements », `MEDIA_SHARED`, table `ProjectMedia`, option d'accès à la bibliothèque) sont supprimées.
- **Domaine de diffusion** : par défaut celui de l'application Nuxt installée ; configurable selon l'infrastructure
  (CDN, domaine dédié) — § 8.
- **Environnements** (test, staging, production…) : traités dans un projet par des clés étiquetées — § 2.4.
- **Dossiers** : conservés car utiles au regroupement, au filtrage et à la navigation — § 11 (sous-étape B5).
- **Transformations à la demande** (crop, taille, qualité, rotation…) : la phase B prépare dès maintenant la grammaire
  d'URL, les signatures, la politique par projet et les garde-fous — § 10.

---

## 1. Résumé en 12 points

1. **Une installation = une organisation cliente**, qui y sert tous ses projets et environnements (validé).
2. Chaque média appartient à **un seul espace** : la **bibliothèque** de l'organisation ou **un projet**. Réutiliser un
   média ailleurs = le **dupliquer** (copie indépendante, provenance conservée).
3. **Un rôle = un ensemble de portées.** Même vocabulaire pour les humains et les jetons ; un jeton ne dépasse jamais
   les droits de ce qui l'a émis.
4. Rôles de plateforme (ADMIN, DEVELOPER, EDITOR) + **rôles de projet** (OWNER, DEVELOPER, EDITOR) ; le rôle de
   plateforme sert de **plafond** (validé).
5. **Cinq identifiants + deux accès sans jeton** : session d'administration, jeton personnel `sm_pat_`, clé secrète
   `sm_sk_`, clé publique `sm_pk_`, jeton délégué éphémère `sm_dt_`, lien signé, accès public (validé). Les clés
   portent une **étiquette d'environnement**.
6. **Aucun secret durable dans un navigateur** : clé publique (lecture de médias publics) ou jeton délégué de quelques
   minutes émis par le backend du client.
7. **Le projet est explicite dans chaque URL d'API** (`/api/v1/projects/{id}/…`).
8. **Toutes les requêtes sont cloisonnées côté serveur** à partir de l'identité ; un média hors périmètre → **404**.
9. **Diffusion `/m/…` sans cookie et indépendante de l'API**, par défaut sur le domaine de l'application,
   configurable (CDN, domaine dédié).
10. **Cache par générations** (compteurs de révision) et **liens signés alignés sur des tranches de temps**.
11. **Transformations préparées** : grammaire d'URL réservée, signatures couvrant les transformations, politique par
    projet, dérivés persistés, garde-fous contre les abus.
12. Livraison en **5 sous-étapes (B1 → B5)**, avec **Vitest** pour le moteur d'autorisation (validé).

## 2. Modèle conceptuel

```text
Installation (= organisation cliente : tous ses projets et environnements)
├─ Utilisateurs ─── rôle de plateforme : ADMIN | DEVELOPER | EDITOR
├─ Bibliothèque de l'organisation ─── dossiers ─── médias
└─ Projets ─── membres (OWNER | DEVELOPER | EDITOR), clés d'API (étiquetées par environnement),
      │        origines CORS, réglages
      └─ dossiers ─── médias

Média = fichier + versions + dérivés + métadonnées + visibilité (PUBLIC | PRIVATE)
        appartient à UN espace : Media.projectId (null = bibliothèque)
```

### 2.1 Règles

- **R1 — Appartenance unique.** Un média appartient à exactement un espace : un projet ou la bibliothèque.
- **R2 — Lecture.** Un principal lit M s'il a `media:read` dans l'espace de M. Via l'API d'un projet, seuls les
  médias **de ce projet** sont accessibles.
- **R3 — Modification et suppression.** Métadonnées, visibilité, remplacement, déplacement de dossier : `media:write`
  dans l'espace de M ; corbeille, restauration, suppression définitive : `media:delete`. L'ADMIN passe toujours.
- **R4 — Duplication.** Lire M dans son espace + `media:upload` dans l'espace cible → **copie indépendante** (§ 2.2).
- **R5 — Visibilité.** Public/privé est une propriété du média.
- **R6 — Diffusion.** Un média public est servi sans condition ; un média privé exige une preuve : lien signé, ou
  jeton habilité dans son espace.
- **R7 — Envoi.** Un média envoyé dans le contexte d'un projet appartient à ce projet ; depuis la bibliothèque, à la
  bibliothèque. Provenance conservée (utilisateur ou identifiant, sujet final éventuel).
- **R8 — Corbeille.** Supprimer = mettre à la corbeille (le média reste dans son espace) ; suppression définitive
  uniquement depuis la corbeille (existant).

### 2.2 Duplication (et déplacement, à confirmer)

- **Dupliquer** (bibliothèque → projet, projet → projet, projet → bibliothèque) crée un **nouveau média** :
  - nouvel identifiant, version 1, nouvelles URL ;
  - **fichier copié** dans le stockage (`MediaStorage.copy` : copie côté serveur sous S3, `CopyObject`, sans transit par
    surgeMedia ; copie de fichier en local) ;
  - métadonnées copiées (titre, texte alternatif, visibilité, dimensions, métadonnées techniques, nom d'origine,
    empreinte) ; dossier cible au choix (racine par défaut) ;
  - `duplicatedFromId` renseigné (provenance) ; dérivés non copiés, régénérés à la demande (aperçu pré-généré).
  - Les deux médias évoluent ensuite **séparément** (modifier l'un ne touche pas l'autre).
- Coût assumé : le fichier occupe deux fois l'espace de stockage (une déduplication physique par contenu reste
  possible plus tard sans changer le modèle).
- **Déplacer** (proposé, coût faible grâce à R1) : changer l'espace d'un média **sans changer son identifiant ni ses
  URL** (utile après un envoi dans le mauvais projet). Droits : `media:delete` à la source + `media:upload` à la cible.
  Les applications de l'ancien projet perdent l'accès par l'API ; l'URL publique continue de fonctionner.

### 2.3 Cycle de vie d'un projet

- **Archiver** : clés et jetons refusés, médias en lecture seule, projet masqué par défaut ; réversible.
- **Supprimer** (projet archivé uniquement, confirmation par saisie du nom) avec un choix explicite pour ses médias :
  **déplacer vers la bibliothèque** (URL conservées) ou **supprimer définitivement** (lignes puis fichiers, en tâche
  de fond). Membres, clés, origines et dossiers sont supprimés avec le projet.
- En base, `Media.projectId` est en `onDelete: Restrict` : un projet ne peut pas emporter ses médias par cascade
  (aucun fichier orphelin par accident).

### 2.4 Environnements (test, staging, production…)

- **Recommandation** : un projet = une application ; ses environnements **partagent ses médias** (le contenu est le
  même en staging et en production).
- Chaque clé porte une **étiquette d'environnement** (`production`, `staging`, `development`, `test` ou libre) :
  une clé par environnement, révocable séparément, affichée et filtrée par environnement dans l'interface.
- Les origines autorisées du projet listent celles de tous ses environnements (ex. `https://www.example.com`,
  `https://staging.example.com`, `http://localhost:3000`).
- Un environnement qui produit des **envois jetables** (tests automatisés) utilise un **projet distinct** ; la
  duplication y copie les médias de référence.
- Pas d'entité « environnement » en base : la clé publique ne lit que des médias publics, donc des origines séparées par
  environnement n'apporteraient presque rien en sécurité. L'étiquette pourra devenir une entité plus tard sans rupture.

## 3. Rôles et portées

### 3.1 Vocabulaire des portées (commun aux humains et aux jetons)

| Portée | S'applique à | Autorise |
| --- | --- | --- |
| `media:read` | un espace (projet ou bibliothèque) | lister, chercher, lire les métadonnées, obtenir les URL (signées si privé), dossiers |
| `media:upload` | un espace | créer des médias (envoi, duplication vers cet espace) |
| `media:write` | un espace | métadonnées, visibilité, remplacement, dossiers |
| `media:delete` | un espace | corbeille, restauration, suppression définitive, déplacement hors de l'espace |
| `project:read` | un projet | voir le projet |
| `project:credentials` | un projet | clés publiques/secrètes, origines CORS |
| `project:members` | un projet | gérer les membres |
| `project:settings` | un projet | nom, description, options, archivage, suppression |
| `projects:create` | plateforme | créer des projets |
| `tokens:personal` | plateforme | créer ses propres jetons personnels |
| `users:manage` | plateforme | gérer les comptes |

### 3.2 Rôles de plateforme (`User.role`)

| Rôle | Bibliothèque | Projets | Jetons personnels | Utilisateurs |
| --- | --- | --- | --- | --- |
| ADMIN | `media:*` | **tous**, comme OWNER implicite ; création | ✓ | ✓ |
| DEVELOPER | `media:*` | ceux dont il est membre ; **création** (il en devient OWNER) | ✓ | – |
| EDITOR | `media:*` | ceux dont il est membre | – | – |

### 3.3 Rôles de projet (`ProjectMember.role`)

| Rôle | Portées dans le projet |
| --- | --- |
| OWNER | `project:*` + `media:*` |
| DEVELOPER | `project:read`, `project:credentials`, `media:*` |
| EDITOR | `project:read`, `media:*` |

- **Plafond** : rôle effectif = min(rôle de projet, plafond du rôle de plateforme) ; un EDITOR de plateforme ne peut
  être qu'EDITOR dans un projet. Rétrograder un utilisateur réduit immédiatement ses droits partout.
- **Invariant `LAST_OWNER`** (409) : impossible de retirer ou de rétrograder le dernier OWNER d'un projet (l'ADMIN
  peut toujours administrer un projet orphelin, par exemple après la suppression d'un compte).

### 3.4 Droits effectifs

```text
portées(principal, espace) =
  session           → portées du rôle (plafonné) dans l'espace
  jeton personnel   → portées du jeton ∩ portées actuelles de son propriétaire dans l'espace
                      (∅ si l'espace n'est pas dans la sélection du jeton)
  clé secrète       → portées de la clé si espace = son projet, sinon ∅
  clé publique      → { media:read } restreint aux médias PUBLIC, si espace = son projet
  jeton délégué     → portées du jeton ∩ portées actuelles de l'émetteur, si espace = son projet
```

**Les jetons ne gèrent jamais les accès** : aucune portée de jeton ne permet de gérer des utilisateurs, des membres,
des clés, des origines ou les réglages d'un projet (seule exception : émettre des jetons délégués, plus restreints et
éphémères). Une fuite de jeton ne peut pas s'auto-entretenir.

## 4. Identifiants et jetons

### 4.1 Les sept mécanismes

| Mécanisme | Format | Où il vit | Périmètre | Portées possibles | Durée | Stockage serveur |
| --- | --- | --- | --- | --- | --- | --- |
| **Session d'administration** | cookie scellé (existant) | navigateur, HttpOnly | selon rôles | selon rôles | 12 h | table `Session` |
| **Jeton personnel (PAT)** | `sm_pat_…` | poste du développeur, CI, scripts | projets choisis ou « tous mes projets », bibliothèque en option | ⊆ `media:*`, `project:read` | **obligatoire** : 30 / 90 / 365 j (90 par défaut) | empreinte SHA-256 |
| **Clé secrète de projet** | `sm_sk_…` | variables d'environnement d'un serveur | **un** projet | ⊆ `media:*` | facultative (1 an recommandé) | empreinte SHA-256 |
| **Clé publique de projet** | `sm_pk_…` | code frontend (publique par nature) | **un** projet, origines autorisées | `media:read` sur médias PUBLIC (fixe) | illimitée, révocable | empreinte + valeur (non secrète, réaffichable) |
| **Jeton délégué** | `sm_dt_<charge>.<signature>` | mémoire du navigateur (composant) | **un** projet | ⊆ portées de l'émetteur | 1 à 60 min (15 par défaut) | aucun (signé) ; compteur d'envois éventuel |
| **Lien signé** | `?exp&kid&sig` (existant, étendu) | URL (`<img src>`) | un média, une version, un fichier ou dérivé | lecture | 60 s à 7 j | aucun |
| **Accès public** | — | — | médias PUBLIC | lecture du fichier | permanent (URL versionnée) | — |

Les clés secrètes et publiques portent une **étiquette d'environnement** (§ 2.4).

### 4.2 Cas d'usage → mécanisme

| Cas | Mécanisme | Détail |
| --- | --- | --- |
| Administration de la plateforme | **Session** ; **PAT d'un ADMIN** pour l'automatisation | gestion des utilisateurs et des accès réservée à l'interface |
| Développeur sur un ou plusieurs projets | **Session** + **PAT** limité aux projets choisis | droits liés au compte : désactivé ou retiré d'un projet → accès perdu immédiatement |
| Propriétaire d'un projet | **Rôle OWNER** (session, PAT) | membres, réglages, toutes les clés du projet |
| Application frontend (site public) | **Clé publique** de l'environnement | médias PUBLIC ; liste/recherche si l'option « liste publique » est activée |
| Application frontend (espace connecté, médias privés) | **Jeton délégué** `media:read` émis par le backend du client | le backend authentifie son utilisateur puis demande un jeton de 15 min |
| Composant Upload | **Jeton délégué** `media:upload` + contraintes | nombre de fichiers, taille, types, visibilité imposée, dossier, origine |
| MediaPicker / MediaLibrary dans un back-office client | **Jeton délégué** (`media:read` [+ `upload`, `write`, `delete`]) | renouvelé par le composant via un rappel `getToken()` |
| Application cliente externe | serveur : **clé secrète dédiée** (portées minimales) ; mobile/desktop : **clé publique + jetons délégués** ; au nom d'utilisateurs surgeMedia : OAuth 2.1 (plus tard) | une clé par intégration, révocable seule |
| API backend | **Clé secrète** | refusée depuis un navigateur ; rotation avec recouvrement |
| Accès public à un média | **Aucun jeton** | URL versionnée immuable, CDN |
| Accès temporaire à un média privé | **Lien signé** | émis par l'interface, une clé secrète, un PAT, ou inclus dans les réponses de l'API |

### 4.3 Format des jetons opaques (PAT, clés)

- `sm_<type>_<corps>` avec `<type>` ∈ `pat`, `sk`, `pk` ; `<corps>` = 32 octets aléatoires en base62 (43 caractères)
  + **CRC32 en base62** (6 caractères), à la manière de GitHub : rejet **sans accès à la base** des jetons mal formés
  (protection contre les inondations), détection des fuites par les outils d'analyse de secrets. La sécurité vient des
  256 bits aléatoires, pas du CRC.
- Stockage : **SHA-256** (index unique) ; pas d'argon2 (256 bits d'entropie, vérification à chaque requête).
  Préfixe lisible conservé pour l'affichage (`sm_sk_4fQ9Zt…`).
- Jeton complet affiché **une seule fois** (sauf la clé publique). Uniquement `Authorization: Bearer` : jamais dans une
  URL (`?access_token=` refusé : journaux, en-tête Referer).
- **Opaque plutôt que JWT pour les jetons durables** : révocables instantanément, courts, sans données lisibles. Les
  formats signés sans état sont réservés aux preuves **courtes** (jeton délégué, lien signé).

### 4.4 Cycle de vie

- **Création** : nom, environnement (clés), projet(s) (PAT), portées (préréglages « lecture seule », « lecture et
  envoi », « complet »), expiration. Confirmation du mot de passe si la dernière saisie date de plus de 10 min
  (« mode sudo ») pour créer une clé secrète ou un PAT et pour modifier les membres.
- **Portées immuables** après création (pour changer : nouvel identifiant).
- **Rotation** d'une clé secrète : la nouvelle clé est créée, l'ancienne reste valable pendant une période de
  recouvrement choisie (immédiat, 1 h, 24 h, 7 j).
- **Révocation** immédiate (`revokedAt`) : instantanée sur l'instance, ≤ 60 s sur les autres (§ 9.6). Révoquer un
  émetteur invalide ses jetons délégués.
- **Dernière utilisation** (date, IP) enregistrée au plus toutes les 5 min.
- **Désactivation d'un utilisateur** → ses PAT cessent de fonctionner ; les clés de projet qu'il a créées **restent
  actives** (elles appartiennent au projet), l'interface signale « créée par un compte désactivé ».
- **Archivage / suppression d'un projet** : § 2.3.

### 4.5 Jetons délégués (composants dans le navigateur)

```http
POST /api/v1/projects/{projectId}/delegated-tokens
Authorization: Bearer sm_sk_…
{ "scopes": ["media:upload"], "expiresIn": 600, "subject": "user-42",
  "origin": "https://app.example.com",
  "upload": { "maxFiles": 5, "maxSize": 10485760, "types": ["image/jpeg", "image/png"],
              "visibility": "private", "folderId": "…" } }
→ 201 { "token": "sm_dt_eyJ2Ijox….Q2x…", "expiresAt": "2026-09-29T14:10:00Z" }
```

- Charge utile (base64url, lisible par le composant pour anticiper l'expiration) : version, `jti`, émetteur, projet,
  portées, sujet final (identifiant opaque côté client, pour l'audit), échéance, origine, contraintes.
- Signature HMAC-SHA256 avec une clé **dérivée** du secret de signature (séparation des usages) et un `kid` (rotation).
- Vérification : signature, échéance, émetteur toujours valide (en cache), projet actif, origine, contraintes ;
  `maxFiles` garanti par un compteur (`DelegatedTokenUsage`, incrément conditionnel atomique).
- Ne peut ni émettre d'autres jetons ni générer de liens signés longs. Pas de révocation individuelle : durée courte ou
  révocation de l'émetteur.

```text
Navigateur <MediaUpload>          Backend du client (sm_sk_…)               surgeMedia
   │ 1. « puis-je envoyer ? » ─────►│ (authentifie SON utilisateur)           │
   │                                │ 2. POST …/delegated-tokens ────────────►│ vérifie la clé, les portées
   │                                │◄──────────── { token: sm_dt_…, exp } ───│
   │◄──────────── sm_dt_… ──────────│                                         │
   │ 3. POST /api/v1/projects/P/media (multipart, Bearer sm_dt_…) ───────────►│ preflight CORS (origines de P),
   │    progression (XHR)                                                     │ signature, émetteur, origine,
   │◄───────────────────────────────── 201 { média du projet P } ─────────────│ contraintes, analyse du fichier
```

### 4.6 Liens signés, version 2 (prête pour les transformations)

- Chaîne signée : `v2:<mediaId>:<version>:<cible>:<exp>` où `<cible>` vaut `file` (original), `preset:<nom>`,
  `t:<transformation canonique>` ou `derived` (tout dérivé de cette version, jamais l'original — pour construire un
  `srcset` côté client avec une seule signature). Paramètres : `exp`, `kid`, `sig`, et `scope=derived` le cas échéant.
- **`kid`** : le secret peut être changé en conservant l'ancien pour la vérification pendant 7 jours.
- **Échéance alignée sur des tranches** (§ 9.5).
- Les liens actuels (v1, sans `kid`) restent vérifiés pendant la transition.

### 4.7 Garde-fous

- Clé secrète ou PAT reçu avec `Origin` ou `Sec-Fetch-Site` (donc depuis un navigateur) → 403 `SECRET_IN_BROWSER`.
- L'API v1 **n'accepte pas les cookies** (pas de CSRF, pas de confusion avec la session d'administration).
- Clé publique : médias publics seulement ; origine vérifiée **côté serveur** en plus du CORS (anti-abus, pas une
  frontière de sécurité : un client hors navigateur peut forger `Origin`).
- Limitation de débit par identifiant et par IP (§ 6.7) ; échecs d'authentification comptés par IP.
- En-tête `Authorization` masqué dans les journaux ; journal d'audit des actions sensibles.

## 5. Application côté serveur

### 5.1 Identité unique (« principal »)

```ts
type Principal =
  | { kind: 'user', via: 'session' | 'pat', user: AuthUser, token?: TokenRef }
  | { kind: 'project-key', keyType: 'publishable' | 'secret', projectId: string, scopes: Scope[], token: TokenRef }
  | { kind: 'delegated', projectId: string, scopes: Scope[], issuer: TokenRef, subject?: string, constraints: DelegatedConstraints }
  | { kind: 'anonymous' }

type Space = { type: 'library' } | { type: 'project', id: string }
```

Résolution : cookie pour `/api/admin/**` (existant) ; `Authorization: Bearer` pour `/api/v1/**` et `/m/**`.
Résultat gardé dans `event.context.principal`.

### 5.2 Moteur d'autorisation

- Module **pur** : `scopesIn(principal, space)`, `can(principal, scope, space)`, `canReadMedia(principal, media, contexte)`.
  Testé de façon exhaustive avec Vitest (rôles de plateforme × rôles de projet × identifiants × espaces × actions).
- Les routes appellent `requireAccess(event, scope, space)` → 401 / 403 / 404. `requireAuth(event, permission)` reste
  pour les permissions de plateforme.

### 5.3 Requêtes cloisonnées

Les listes et lectures partent de `scopedMediaWhere(principal, space)` : `projectId = <projet de l'URL>` (ou `null`
pour la bibliothèque), `deletedAt: null`, `visibility: PUBLIC` pour une clé publique, restrictions du jeton délégué.
Les filtres de la requête sont **ajoutés** (ET), jamais substitués. Média inexistant ou hors périmètre → même **404**.

### 5.4 Codes d'erreur ajoutés

401 `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` · 403 `INSUFFICIENT_SCOPE`,
`ORIGIN_NOT_ALLOWED`, `SECRET_IN_BROWSER`, `PROJECT_ARCHIVED`, `UPLOAD_LIMIT_REACHED` · 404 `PROJECT_NOT_FOUND`,
`MEDIA_NOT_FOUND`, `FOLDER_NOT_FOUND` · 409 `LAST_OWNER`, `SLUG_TAKEN`, `PROJECT_NOT_ARCHIVED`, `FOLDER_NOT_EMPTY` ·
429 `RATE_LIMITED`. Transformations (phase C) : 400 `INVALID_TRANSFORM`, 403 `TRANSFORM_NOT_ALLOWED`,
429 `TRANSFORM_QUOTA`.

### 5.5 Organisation du code

- `shared/utils/scopes.ts` : portées, rôles → portées, plafonds (auto-importé, utilisé aussi par l'UI).
- `server/lib/access/` : `principal.ts`, `policy.ts` (pur), `tokens.ts` (format, CRC, empreinte, vérification),
  `delegated.ts`.
- `server/lib/projects/` : projets, membres, cycle de vie.
- `server/lib/cache/` : cache à deux niveaux, compteurs de révision.
- `server/lib/media/` : services paramétrés par (principal, espace) ; `duplicate`, `move` ; `transform/` (phase C :
  analyse, canonisation, politique, exécution) ; plus de `defaultProjectId()`.
- `server/lib/storage/` : ajout de `copy(from, to)` à `MediaStorage`.
- `server/api/v1/**`, `server/middleware/api-v1.ts` (CORS, identité, limitation de débit).

## 6. API v1 (applications tierces)

### 6.1 Principes

- REST + JSON, préfixe **`/api/v1`**, évolutions additives uniquement (rupture = `/api/v2`).
- **Projet explicite dans le chemin** : isolation lisible, preflight CORS résolu sans `Authorization` (les navigateurs
  ne l'envoient pas au preflight), clés de cache et journaux par projet, PAT multi-projets. Une clé utilisée sur un
  autre projet que le sien reçoit 404.
- Contrat public **indépendant de l'administration** : valeurs en minuscules (`"image"`, `"public"`), URL **absolues**
  (§ 8), ni e-mails ni chemins physiques.
- **Les API construisent et signent les URL ; les octets sont toujours servis par `/m/`** (un seul chemin à mettre en
  cache, y compris pour les transformations).
- Spécification **OpenAPI 3.1** générée depuis les schémas zod partagés (`z.toJSONSchema`) : `/api/v1/openapi.json`.

### 6.2 Points d'accès

| Méthode et chemin | Portée | Identifiants |
| --- | --- | --- |
| `GET /api/v1/me` | — | tous : type, projet(s), environnement, portées, expiration |
| `GET /api/v1/projects` | `project:read` | PAT (ses projets), clés et jetons délégués (leur projet) |
| `GET /api/v1/projects/{p}` | `project:read` | idem |
| `GET /api/v1/projects/{p}/media` | `media:read` | tous ; clé publique : si « liste publique » activée, médias PUBLIC |
| `GET /api/v1/projects/{p}/media/{id}` | `media:read` | tous (clé publique : PUBLIC seulement) |
| `POST /api/v1/projects/{p}/media` | `media:upload` | clé secrète, PAT, jeton délégué — multipart |
| `PATCH /api/v1/projects/{p}/media/{id}` | `media:write` | clé secrète, PAT, jeton délégué |
| `PUT /api/v1/projects/{p}/media/{id}/file` | `media:write` | idem |
| `DELETE /api/v1/projects/{p}/media/{id}` | `media:delete` | idem — corbeille |
| `POST /api/v1/projects/{p}/media/{id}/duplicate` | `media:read` ici + `media:upload` dans la cible | PAT (seul identifiant multi-espaces) — `{ target: { projectId } \| { library: true }, folderId? }` |
| `POST /api/v1/projects/{p}/media/{id}/signed-url` | `media:read` | clé secrète, PAT — `{ expiresIn, target: file \| preset \| transform \| derived }` |
| `POST /api/v1/projects/{p}/delegated-tokens` | portées ⊆ émetteur | clé secrète, PAT |
| `GET /api/v1/projects/{p}/folders` (B5) | `media:read` | tous sauf clé publique |
| `GET\|HEAD /m/…` | — | public, lien signé, ou Bearer habilité (R6) |

La bibliothèque reste gérée depuis l'interface (et par PAT via les mêmes services si besoin plus tard).

### 6.3 Contrat « Media » (v1)

```json
{
  "id": "cm1q2w3e4r5t6y7u8i9o0p",
  "kind": "image",
  "visibility": "private",
  "title": "Affiche été",
  "altText": "Une plage au coucher du soleil",
  "filename": "affiche-ete.jpg",
  "mimeType": "image/jpeg",
  "extension": "jpg",
  "size": 482113,
  "width": 1920,
  "height": 1080,
  "duration": null,
  "version": 3,
  "folderId": null,
  "url": "https://media.example.com/m/cm1q…/v3/affiche-ete.jpg?exp=1790000000&kid=1&sig=…",
  "previewUrl": "https://media.example.com/m/cm1q…/v3/preview/affiche-ete.webp?exp=…&kid=1&sig=…",
  "urlExpiresAt": "2026-09-29T15:00:00Z",
  "createdAt": "2026-09-18T16:40:00Z",
  "updatedAt": "2026-09-27T11:02:00Z"
}
```

`urlExpiresAt` vaut `null` pour un média public. Phase C (ajout sans rupture) : `urlTemplate` pour construire les URL
transformées côté client (§ 10.6).

### 6.4 Listes, recherche, pagination

- Paramètres : `q`, `kind`, `visibility`, `ids` (≤ 100 : réhydratation des sélections d'un MediaPicker), `folder` et
  `recursive` (B5), `sort` (`newest` | `oldest` | `name` | `size`), `limit` (1–100, 24 par défaut), `cursor`,
  `withTotal`.
- **Pagination par curseur** (keyset, curseur opaque) : coût constant, stable pendant les ajouts ; `total` seulement
  sur demande. L'administration garde ses numéros de page.
- Réponse : `{ "items": Media[], "nextCursor": string | null, "total"?: number }`.

### 6.5 Erreurs (RFC 9457 « Problem Details »)

```json
{ "type": "…/errors#INSUFFICIENT_SCOPE", "title": "Insufficient scope", "status": 403, "code": "INSUFFICIENT_SCOPE",
  "detail": "This credential lacks the media:write scope.", "instance": "/api/v1/projects/…/media/…", "requestId": "…" }
```

`code` est stable et permet aux composants de **traduire** le message (fr/en) ; `title`/`detail` s'adressent aux
développeurs. L'administration garde son format actuel (`data.code`).

### 6.6 CORS (par projet)

- Origines autorisées du projet (tous environnements) : correspondance exacte `schéma://hôte[:port]`, plus
  sous-domaines génériques `https://*.example.com` (déploiements de prévisualisation).
- Preflight `OPTIONS /api/v1/projects/{p}/…` : origine autorisée → `Access-Control-Allow-Origin: <origine>`,
  `-Allow-Methods`, `-Allow-Headers: Authorization, Content-Type, If-None-Match`, `-Max-Age: 7200`, `Vary: Origin` ;
  sinon aucun en-tête CORS. Jamais `Allow-Credentials`.
- Réponses : mêmes en-têtes + `Access-Control-Expose-Headers: ETag, RateLimit, RateLimit-Policy, Retry-After`.
- Contrôle serveur : clé publique ou jeton délégué avec une origine non autorisée → 403 `ORIGIN_NOT_ALLOWED` ; sans
  `Origin` (serveur, application mobile) : accepté pour la clé publique.
- `/m/…` : `Access-Control-Allow-Origin: *` pour les réponses publiques et signées (usage en `fetch`/`canvas`).

### 6.7 Limitation de débit

Seau à jetons par identifiant (et par IP pour la clé publique), en-têtes `RateLimit` / `RateLimit-Policy` (brouillon
IETF) et `Retry-After`. Valeurs initiales proposées, configurables : clé publique 300 req/min par (clé, IP) ; clé
secrète et PAT 1 200 req/min ; envois 60/min par identifiant ; échecs d'authentification 30/min par IP. Mémoire par
défaut, stockage partagé (Redis) en multi-instance.

## 7. Consommation par les frontends et composants

- **`@surge-media/client`** (TypeScript, sans framework, `fetch`, navigateur / Node / edge) : client typé de l'API v1,
  gestion de l'identifiant (clé publique ou rappel `getToken()` qui renouvelle les jetons délégués), itérateurs de
  pagination, envoi avec progression, traduction des codes d'erreur, construction d'URL et de `srcset` (phase C).
- **Logique des composants sans interface** dans ce paquet (sélection, file d'envoi, navigation dans les dossiers),
  puis liaisons fines **`@surge-media/vue` / `react` / `svelte`** : la logique n'est écrite qu'une fois. Composants
  accessibles (WCAG 2.2 AA) et traduits (fr/en).

| Composant | Contexte | Identifiant |
| --- | --- | --- |
| `<MediaImage>` | tout site | aucun (URL publique, `srcset` en phase C) ou URL signée fournie par le backend |
| `<MediaLibrary>` en lecture sur un site public | galerie | clé publique (option « liste publique ») |
| `<MediaPicker>` / `<MediaLibrary>` dans un back-office | choix, gestion | jeton délégué via `getToken()` |
| `<MediaUpload>` | formulaires, back-office | jeton délégué `media:upload` + contraintes |

L'application cliente stocke un **identifiant de média** (stable, indépendant des versions), réhydraté par
`GET …/media?ids=…`.

## 8. Diffusion : domaine et configuration selon l'infrastructure

- **Par défaut : le domaine de l'application Nuxt installée.** Nouvelle variable **`NUXT_SITE_URL`** (URL publique de
  l'installation, demandée par `surge-media init` ; à défaut déduite de la requête, avec un avertissement au démarrage
  en production). Les URL absolues de l'API en dérivent.
- **`NUXT_MEDIA_PUBLIC_URL`** (vide par défaut = `NUXT_SITE_URL`) : base des URL de diffusion, à définir selon
  l'infrastructure du client.

| Infrastructure du client | Configuration |
| --- | --- |
| Serveur seul (défaut) | rien à faire : `https://media-app.example.com/m/…` |
| CDN / cache devant l'application (Cloudflare, Nginx `proxy_cache`, Varnish) | même domaine ; mettre en cache `/m/*` en respectant `Cache-Control` |
| Sous-domaine dédié vers la même application | `NUXT_MEDIA_PUBLIC_URL=https://media.example.com` (sans cookie d'administration) |
| CDN à domaine propre (CloudFront, Bunny…) avec l'application pour origine | `NUXT_MEDIA_PUBLIC_URL=https://cdn.example.com` |
| Plus tard : redirection vers le bucket S3 / son CDN | option « redirection » (302 vers une URL pré-signée courte ; décharge la bande passante mais perd nos en-têtes) |

- **`/m/` sans cookie** : la diffusion ignore les cookies ; l'administration affiche les aperçus privés et la corbeille
  par **liens signés courts**. La diffusion devient entièrement sans état. Les réponses `/m/` ne posent jamais de
  cookie (condition pour qu'un CDN les garde).
- La documentation (`setup.md`, puis le site de documentation) donnera les recettes par infrastructure.

## 9. Performance et cache

**Principe** : le chemin le plus sollicité est la **diffusion des fichiers**, puis la **lecture des listes** ; les
écritures sont rares. On rend la diffusion cachable par un CDN et le plus souvent sans base, les lectures d'API
revalidables à moindre coût (304), et l'on invalide **par versions** plutôt que par purge.

### 9.1 Fichiers statiques (originaux et dérivés)

- URL versionnées immuables (existant) : `public, max-age=31536000, immutable` ; remplacement = nouvelle URL.
- Requêtes partielles **`Range` (206)** + `Accept-Ranges` (utile aussi pour la vidéo, phase D), `Last-Modified`, 304
  (existant), flux sans mise en mémoire (existant).
- **Limite assumée** : passer un média public en privé ou le mettre à la corbeille n'efface pas les copies déjà en
  cache (navigateurs, CDN). Adaptateur facultatif de **purge CDN** (`CdnPurger` : aucun, webhook, fournisseur) ;
  l'interface l'indique lors du changement.

### 9.2 Miniatures et dérivés

- Générés une fois, persistés (`MediaVariant`), immuables (existant) ; déduplication des générations simultanées
  (existant, contrainte d'unicité en multi-instance).
- **Pré-génération de l'aperçu** en tâche de fond après l'envoi ou la duplication.
- **Concurrence de sharp bornée** (sémaphore ≈ nombre de cœurs, file d'attente) ; file saturée → 503 + `Retry-After`.
- Cache mémoire « (média, version, dérivé) → clé de stockage » : pas de requête `MediaVariant` à chaque affichage.
- Garde-fous des transformations libres : § 10.4.

### 9.3 Métadonnées des médias

- Chemin chaud de `/m/` (version, visibilité, corbeille, projet, clé, type, taille, empreinte) : **cache L1 LRU borné**
  (~10 000 entrées), 60 s, invalidé localement à chaque écriture. Le projet y figure pour appliquer sa politique de
  transformations (phase C) sans requête supplémentaire.
- Détail API : ETag faible `W/"<id>-<version>-<updatedAt>"` → 304.

### 9.4 Listes et résultats de recherche/filtrage

- **Compteur de révision par espace** (chaque projet, la bibliothèque), incrémenté par toute écriture dans l'espace.
- **ETag de liste** = empreinte (espace, révision, requête normalisée, audience, tranche de signature) : un
  `If-None-Match` identique → **304 sans exécuter la requête** (seule la révision est lue, gardée quelques secondes en L1).
- **Cache serveur des résultats** (identifiants + curseur suivant) dont la clé contient la révision : une écriture rend
  les anciennes entrées inaccessibles d'elles-mêmes (cache « générationnel », aucune purge). Les objets sont
  reconstitués depuis le cache de métadonnées ; `total` mis en cache par révision.
- Index : `Media(projectId, deletedAt, createdAt)`, `Media(projectId, folderId)`, `Media(projectId, checksum)`.
- **Recherche normalisée** : colonnes de recherche en minuscules et sans accents (une par champ, ≤ 191 caractères pour
  MySQL), saisie normalisée de la même façon → insensible à la casse **et aux accents** sur les trois bases (corrige la
  limite SQLite connue). Interface `MediaSearch` : `LIKE` par défaut, implémentations natives possibles pour les gros
  volumes (PostgreSQL `pg_trgm`, MySQL FULLTEXT, SQLite FTS5).
- En-têtes : `Cache-Control: private, no-cache` + ETag par défaut. Option de projet « liste publique cachable » pour les
  réponses à clé publique (données publiques) : `public, s-maxage=60, stale-while-revalidate=300`.

### 9.5 URL et liens signés

- URL publiques : calcul pur, sans base.
- Liens signés HMAC : vérification sans base (existant).
- **Échéance alignée sur des tranches** : pour une durée D, l'échéance est arrondie à la tranche suivante (ex. D = 1 h,
  tranche = 15 min) → **même URL** pour tous les appels d'une tranche : cache navigateur/CDN efficace, ETag de liste
  stables. Validité réelle entre D et D + tranche.
- Réponse signée : `private, max-age=<reste>` (existant) ; option « partageable » (`public`) pour qu'un CDN la garde
  jusqu'à l'échéance, sans risque puisque l'URL elle-même est la preuve d'accès.

### 9.6 Identifiants et configuration des projets

- Jeton opaque : format + CRC (sans base) → **cache L1 « empreinte → identité »** (60 s, invalidé localement à la
  révocation) → base. Jeton délégué : signature sans base ; état de l'émetteur dans le même cache.
- Origines, réglages et politique de transformation d'un projet : L1 60 s ; preflights gardés par le navigateur.
- `lastUsedAt` écrit au plus toutes les 5 min.

### 9.7 Récapitulatif

| Donnée | Où | Clé | Durée | Invalidation |
| --- | --- | --- | --- | --- |
| Fichier public (original, dérivé, transformation) | navigateur, CDN | URL versionnée | 1 an, immuable | nouvelle version ; purge CDN facultative |
| Fichier privé signé | navigateur (CDN en option) | URL signée (tranche) | jusqu'à l'échéance | échéance ; nouvelle version |
| Dérivé généré | stockage + `MediaVariant` | (média, version, transformation canonique) | permanent | nouvelle version (anciens supprimés) |
| Métadonnées de diffusion | L1 (+ L2) | `media:<id>` | 60 s | écriture sur le média |
| Clé de dérivé | L1 | `variant:<id>:<v>:<t>` | 10 min | nouvelle version |
| Liste / recherche | L1 (+ L2) + ETag client | espace + révision + requête + audience | 5 min | révision de l'espace (automatique) |
| Détail média (API) | ETag client | id + version + updatedAt | revalidation | modification |
| Identité d'un jeton | L1 (+ L2) | empreinte | 60 s | révocation |
| Réglages, origines, politique d'un projet | L1 | `project:<id>` | 60 s | modification |
| Preflight CORS | navigateur | origine + URL | 2 h | — |

### 9.8 Invalidation : événement → action

| Événement | Actions |
| --- | --- |
| Envoi dans un espace | révision de l'espace + 1 ; pré-génération de l'aperçu |
| Métadonnées, visibilité, remplacement, corbeille, restauration, changement de dossier | révision de l'espace + 1 ; L1 `media:<id>` ; purge CDN si public → privé ou corbeille |
| Duplication | révision de l'espace cible + 1 |
| Déplacement entre espaces | révision des deux espaces + 1 ; L1 `media:<id>` |
| Dossiers (création, renommage, déplacement, suppression) | révision de l'espace + 1 |
| Révocation d'un identifiant | L1 de l'identité |
| Origines, réglages, politique, archivage d'un projet | L1 `project:<id>` |
| Changement de rôle, désactivation, retrait d'un membre | aucune (droits recalculés à chaque requête ; PAT : L1 60 s) |

### 9.9 Infrastructure

- **Cache à deux niveaux** : L1 en mémoire (LRU borné, par processus) ; L2 facultatif via le **stockage Nitro**
  (unstorage, déjà embarqué : aucune nouvelle dépendance), pilote Redis/Valkey activé par variables d'environnement ;
  le même stockage sert à la limitation de débit en multi-instance.
- Compteurs de révision **en base** (vérité partagée entre instances), relus au plus toutes les quelques secondes.
- **SQLite** : activer le mode **WAL** (lectures concurrentes pendant les écritures ; non activé aujourd'hui).
  PostgreSQL recommandé dès plusieurs instances ou un gros volume.
- **Tâches de fond** (tâches Nitro) : pré-génération des aperçus, purge des fichiers après suppression définitive ou
  suppression de projet, purge des compteurs de jetons délégués expirés, remplissage des colonnes de recherche.

## 10. Préparation des transformations à la demande (phase C)

Objectif : `crop`, taille, qualité, rotation, format… accessibles **par URL GET** (et construits/signés par l'API et
le SDK), sans rework de la phase B.

### 10.1 Grammaire d'URL (réservée dès la phase B)

```text
/m/<id>/v<n>/<nom>.<ext>              original (extension d'origine)
/m/<id>/v<n>/<préréglage>/<nom>.<ext>  préréglage nommé : preview, thumb, hero…  → ^[a-z][a-z0-9-]{0,31}$
/m/<id>/v<n>/<paramètres>/<nom>.<ext>  transformation libre : w_800,h_600,fit_cover,q_75  → clé_valeur séparés par « , »
```

- **Le format de sortie est donné par l'extension** (`jpg`, `png`, `webp`, `avif`) : un seul moyen de le choisir, donc
  une seule URL par résultat. Pas de négociation automatique par défaut (`Vary: Accept` fragmente les caches CDN) ; les
  composants produisent un `<picture>` avec des sources AVIF/WebP/JPEG.
- Un nom de préréglage ne contient jamais `_` : pas d'ambiguïté avec les paramètres. `preview` (existant) devient un
  préréglage intégré ; son URL actuelle ne change pas.
- La chaîne de requête ne sert qu'aux signatures (`exp`, `kid`, `sig`, `scope`).

### 10.2 Paramètres proposés

| Paramètre | Valeurs | Effet |
| --- | --- | --- |
| `crop_x-y-l-h` | pixels dans l'image orientée | extraction d'une zone |
| `r_` | 90, 180, 270 (angles libres plus tard) | rotation |
| `flip_` | `h`, `v`, `hv` | miroir |
| `w_`, `h_` | 1 à 4096 (configurable) | dimensions cibles |
| `dpr_` | 1 à 3 | densité d'affichage (multiplie `w` et `h`, dans la limite) |
| `fit_` | `cover`, `contain`, `fill`, `inside`, `outside` | mode de redimensionnement (sharp) ; `cover` si `w` et `h`, proportionnel sinon |
| `g_` | `center`, `north`… `northwest`, `attention`, `entropy`, `focal` | ancrage du recadrage ; `focal` = point d'intérêt enregistré sur le média |
| `q_` | 1 à 100 | qualité (défaut par format) |
| `bg_` | couleur `rrggbb` | fond (`contain`, transparence vers JPEG) |

- **Ordre d'exécution fixe** (indépendant de l'ordre dans l'URL) : orientation EXIF → rotation/miroir → zone → taille
  → fond → encodage (métadonnées **retirées**, profil sRGB). Les coordonnées de zone s'entendent après rotation.
- **Forme canonique** : clés dans un ordre fixe, valeurs par défaut omises, nombres normalisés. Une URL non canonique
  reçoit une **redirection 301** vers la forme canonique : un résultat = une URL = un fichier en cache.
- Pas d'agrandissement au-delà de l'original par défaut ; zone hors de l'image → 400 `INVALID_TRANSFORM`.
- Images animées : première image en v1 de la phase C.

### 10.3 Politique par projet

Chaque média appartenant à un seul espace, la politique de son projet (ou la politique globale pour la bibliothèque)
s'applique sans ambiguïté :

| Mode | Transformations libres | Usage |
| --- | --- | --- |
| `open` (défaut proposé) | autorisées dans les limites + quotas (§ 10.4) | sites publics construisant leur `srcset` côté client |
| `signed` | exigent une signature (`?sig`, sans échéance pour un média public : URL permanente et cachable) | installations exposées à fort trafic |
| `presets` | interdites, seuls les préréglages | contrôle maximal |

Médias privés : toujours une signature (cible précise, préréglage, ou `derived`, § 4.6). Préréglages : globaux et par
projet (modèle `TransformPreset`), gérés dans l'interface (`project:settings`).

### 10.4 Garde-fous contre les abus

- Bornes : dimensions de sortie (4096 × 4096 par défaut), densité, qualité, formats autorisés ; limite de pixels en
  entrée (existante, 100 Mpx).
- **Quota de dérivés distincts par version de média** (ex. 50) et **débit de nouvelles générations** par IP ;
  au-delà : 429 `TRANSFORM_QUOTA` ou 403 `TRANSFORM_NOT_ALLOWED`, tandis que les dérivés existants et les préréglages
  restent servis.
- Concurrence de sharp bornée et générations dédoublonnées (§ 9.2) ; l'encodage AVIF (coûteux en calcul) utilise un
  effort réduit.
- Canonisation (§ 10.2) : impossible de multiplier les copies d'un même résultat en permutant les paramètres.

### 10.5 Stockage et cache des transformations

Identique aux dérivés actuels : `MediaVariant (mediaId, transformation canonique)`, clé de stockage
`variants/<id>/v<n>-<empreinte>.<ext>`, cache immuable ; suppression des dérivés à chaque nouvelle version (existant).
Plus tard : purge des dérivés jamais redemandés.

### 10.6 API et SDK

- `POST …/signed-url` accepte une cible `transform` ou `preset` (ou `derived`).
- Contrat média (ajout sans rupture) : `urlTemplate` = `https://…/m/<id>/v3/{transform}/affiche-ete.{format}`
  (+ paramètres de signature `derived` pour un média privé) ; le SDK expose `mediaUrl(media, options)` et
  `srcset(media, largeurs)`.
- Point d'intérêt (`Media.focalX`, `focalY`, 0–1) réglable dans l'interface pour `g_focal`.
- Plus tard : « appliquer et remplacer » (une transformation devient une nouvelle version de l'original).

### 10.7 Ce que la phase B fait dès maintenant pour la phase C

- Grammaire de `/m/` réservée (préréglages / paramètres) et redirection de version conservée.
- Liens signés v2 (§ 4.6) : cible et `kid` inclus → aucun changement de format en phase C.
- Métadonnées de diffusion en cache avec le projet → politique applicable sans requête.
- Concurrence de sharp bornée, pré-génération, déduplication (B4).
- Réglages de projet extensibles (la politique et les préréglages s'y ajoutent sans migration de fond).
- `MediaVariant` inchangé (déjà conçu pour des transformations canoniques).

## 11. Dossiers (sous-étape B5)

**Conservés** : ils servent au regroupement (sections d'un site, campagnes), au **filtrage** dans l'API
(`folder`, `recursive`), à la **navigation** dans `<MediaPicker>` et l'administration, et aux actions groupées. Des
**étiquettes** (plusieurs par média) pourront compléter plus tard pour le classement transversal.

- Un dossier appartient à un espace (`Folder.projectId`, null = bibliothèque) ; arborescence (profondeur ≤ 8),
  nom ≤ 100 caractères, unique parmi ses frères (contrôlé par l'API).
- Un média est dans 0 ou 1 dossier de son espace (`Media.folderId`).
- Filtre récursif : descendants calculés depuis l'arbre de l'espace (petit, mis en cache par révision) →
  `folderId IN (…)`. Portable, sans colonne de chemin (la limite de 191 caractères de MySQL l'aurait bridée).
- Suppression d'un dossier : refusée s'il n'est pas vide (409 `FOLDER_NOT_EMPTY`), l'interface proposant de déplacer
  son contenu vers le parent.
- Droits : `media:read` pour lire l'arbre, `media:write` pour créer, renommer, déplacer, supprimer.
- Duplication et déplacement entre espaces : dossier cible au choix (racine par défaut).

## 12. Modèle de données proposé (Prisma)

```prisma
enum ProjectRole { OWNER DEVELOPER EDITOR }
enum TokenType { PERSONAL SECRET PUBLISHABLE }

model Project {
  id            String    @id @default(cuid())
  name          String
  slug          String    @unique
  description   String?
  /// La clé publique peut lister/chercher (sinon : lecture par identifiants seulement)
  publicListing Boolean   @default(false)
  archivedAt    DateTime?
  createdById   String?                                   // User, SetNull
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  // phase C : transformPolicy, préréglages
  members ProjectMember[]  media Media[]  folders Folder[]  tokens AccessToken[]  tokenGrants AccessTokenProject[]  allowedOrigins AllowedOrigin[]
}

model ProjectMember {
  projectId String
  userId    String                                        // Cascade des deux côtés
  role      ProjectRole
  createdAt DateTime @default(now())
  @@id([projectId, userId])
  @@index([userId])
}

model Folder {
  id        String   @id @default(cuid())
  /// null = bibliothèque de l'organisation
  projectId String?                                       // Cascade
  parentId  String?                                       // Cascade (arbre)
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([projectId, parentId])
}

model Media {
  /// null = bibliothèque de l'organisation ; Restrict : un projet n'emporte jamais ses médias par cascade
  projectId         String?                               // Project, Restrict
  folderId          String?                               // Folder, SetNull (existant)
  /// Média d'origine d'une duplication
  duplicatedFromId  String?                               // Media, SetNull
  /// Colonnes de recherche normalisées (minuscules, sans accents), remplies par l'application
  searchTitle       String?
  searchName        String  @default("")
  searchAlt         String?
  uploadedById      String?                               // User, SetNull (existant)
  uploadedByTokenId String?                               // AccessToken, SetNull
  /// Sujet final déclaré par l'application cliente (jeton délégué), pour l'audit
  uploadSubject     String?
  // … champs existants inchangés (kind, visibility, storageKey, version, checksum, deletedAt…)
  // phase C : focalX, focalY
  @@index([projectId, deletedAt, createdAt])
  @@index([projectId, folderId])
  @@index([projectId, checksum])
}

/// Identifiant d'API : jeton personnel, clé secrète ou clé publique de projet
model AccessToken {
  id             String    @id @default(cuid())
  type           TokenType
  name           String
  /// Clés de projet (SECRET, PUBLISHABLE) ; null pour un jeton personnel
  projectId      String?                                  // Cascade
  /// Étiquette d'environnement des clés de projet (production, staging, development, test…)
  environment    String?
  /// Propriétaire d'un jeton personnel
  userId         String?                                  // Cascade
  /// Jeton personnel : tous les projets de son propriétaire (sinon : AccessTokenProject)
  allProjects    Boolean   @default(false)
  /// Jeton personnel : accès à la bibliothèque
  includeLibrary Boolean   @default(false)
  prefix         String
  tokenHash      String    @unique
  /// Valeur en clair, uniquement pour une clé publique (non secrète)
  publicValue    String?
  scopes         String                                   // séparées par des espaces, immuables
  expiresAt      DateTime?
  lastUsedAt     DateTime?
  lastUsedIp     String?
  revokedAt      DateTime?
  createdById    String?                                  // SetNull
  createdAt      DateTime  @default(now())
  @@index([projectId])
  @@index([userId])
}

model AccessTokenProject {
  tokenId   String
  projectId String                                        // Cascade des deux côtés
  @@id([tokenId, projectId])
  @@index([projectId])
}

model AllowedOrigin { /* inchangé */ }

model DelegatedTokenUsage {
  jti       String   @id
  uploads   Int      @default(0)
  expiresAt DateTime
  @@index([expiresAt])
}

/// Compteurs de révision pour le cache (« project:<id> », « library »)
model CacheRevision {
  scope     String   @id
  revision  Int      @default(0)
  updatedAt DateTime @updatedAt
}

/// Journal d'audit des actions sensibles (identifiants, membres, suppressions, visibilité, projets)
model AuditEvent {
  id          String   @id @default(cuid())
  at          DateTime @default(now())
  actorUserId String?
  tokenId     String?
  projectId   String?
  action      String                                      // ex. "token.created", "project.deleted"
  targetType  String?
  targetId    String?
  ipAddress   String?
  data        Json?
  @@index([projectId, at])
  @@index([at])
}
```

Règles de portabilité respectées (pas de `@db.*`, pas de listes scalaires, chaînes ≤ 191). L'unicité des noms de
dossiers et des préréglages (clés nulles) est contrôlée par l'API, les bases traitant différemment `NULL` dans les
index uniques.

## 13. Migration de l'existant

1. **Schéma** (migration pour les 3 fournisseurs, reprise de données écrite à la main) :
   - `Media.projectId` devient facultatif ; les médias du projet technique `default` → **bibliothèque** (`null`) ;
   - suppression du projet `default` (aucune clé ni origine n'a pu y être créée) ;
   - `Folder.projectId` devient facultatif ; `Media.folderId` conservé ;
   - `AccessToken` restructuré (table vide aujourd'hui) ; nouvelles tables ;
   - colonnes de recherche remplies par une tâche au démarrage (la suppression des accents n'est pas portable en SQL).
2. **Code** : suppression de `defaultProjectId()` ; permissions `media:manage` / `tokens:manage` / `api:manage`
   remplacées par les portées ; services médias paramétrés par (principal, espace) ; `authorizeDelivery` sans session ;
   `MediaStorage.copy`.
3. **Interface** : la page Médias devient « Bibliothèque » ; les écrans Projets et Jetons remplacent les sections
   « à venir ».

## 14. Interface d'administration

- Barre latérale : Tableau de bord · Bibliothèque · Projets · Jetons personnels · Utilisateurs (filtrée par portées).
- **Projets** : liste (mes projets ; tous pour l'ADMIN ; archivés masqués par défaut), création (nom, identifiant
  lisible généré, description).
- **Fiche projet** (routes sœurs `/admin/projects/[id]/…`) : Aperçu et réglages · Médias (même écran que la
  bibliothèque, limité au projet) · Membres · Clés d'API (publique, secrètes, par environnement) · Origines autorisées ·
  Zone sensible (archiver, supprimer avec choix pour les médias).
- **Fiche média** : espace d'appartenance, actions « Dupliquer vers… » et « Déplacer vers… » (espaces où l'utilisateur
  peut envoyer), le reste inchangé.
- **Jetons personnels** : liste, création (nom, expiration, projets, bibliothèque, portées), affichage unique, révocation.
- Nouveaux composants probables : onglets de sous-navigation, groupe de cases à cocher (portées), tableau, arbre de
  dossiers (B5). Tout en fr/en, WCAG 2.2 AA, avec les patrons existants (`UiDialog`, `UiCopyField`, `UiRadioCards`,
  `useFlash`…).

## 15. Découpage et vérification

| Sous-étape | Contenu |
| --- | --- |
| **B1 — Modèle, autorisations, projets** | migrations ; moteur de portées + **Vitest** ; projets (création, réglages, archivage, suppression) ; membres et rôles ; bibliothèque et médias de projet dans l'admin ; duplication (+ déplacement si validé) ; `MediaStorage.copy` ; `/m/` sans cookie (aperçus signés) ; `NUXT_SITE_URL`, `NUXT_MEDIA_PUBLIC_URL` |
| **B2 — Identifiants** | clés publiques et secrètes (environnements), PAT, origines CORS (écrans) ; affichage unique, révocation, rotation, dernière utilisation ; confirmation du mot de passe ; journal d'audit |
| **B3 — API v1 en lecture** | résolution de l'identité ; `/me`, projets, liste/détail/`ids` ; liens signés v2 (`kid`, tranches, cibles) ; CORS ; RFC 9457 ; limitation de débit ; caches (identités, métadonnées, révisions, ETag) ; Bearer sur `/m/` ; `Range` ; OpenAPI |
| **B4 — API v1 en écriture + jetons délégués** | envoi, PATCH/PUT/DELETE, duplication ; jetons délégués (lecture, envoi, contraintes) ; pré-génération des aperçus ; concurrence sharp bornée |
| **B5 — Dossiers** | arbre par espace dans l'admin, filtre `folder`/`recursive` dans l'API, contraintes d'envoi par dossier |
| Ensuite | **phase C** (transformations, § 10), puis `@surge-media/client` + composants (Vue d'abord), qui profiteront directement des transformations (`srcset`) |

À chaque sous-étape : `typecheck`, `i18n:check`, `a11y:contrast`, `db:migration --check`, tests Vitest, build de
production, scénarios d'API rejoués en dev et en prod (y compris les refus : autre projet, portée absente, origine
interdite, jeton expiré/révoqué), audit axe fr/en × clair/sombre, `setup.md` et `project-context.md` mis à jour.

## 16. Décisions

| # | Décision | Statut |
| --- | --- | --- |
| D1 | Une installation = une organisation cliente (tous ses projets et environnements) | **validé** |
| D2 | Médias existants → bibliothèque ; projet `default` supprimé | **validé** |
| D3 | Un média = **un seul espace** (bibliothèque ou projet) ; réutilisation par **duplication** | **validé (modifié par l'utilisateur)** |
| D4 | Rôles de projet OWNER / DEVELOPER / EDITOR ; plafond ; DEVELOPER crée des projets ; tous les rôles gèrent la bibliothèque | **validé** |
| D5 | PAT, clé secrète mono-projet, clé publique, jeton délégué, lien signé ; portées immuables ; aucun jeton ne gère les accès | **validé** |
| D6 | Clé publique : médias publics ; liste publique désactivée par défaut | **validé** |
| D7 | API v1 : projet dans le chemin, sans cookies, clés secrètes refusées depuis un navigateur, RFC 9457, minuscules, curseurs | **validé** |
| D8 | `/m/` sans cookie ; diffusion par défaut sur le domaine de l'application (`NUXT_SITE_URL`), configurable (`NUXT_MEDIA_PUBLIC_URL`, § 8) | **validé (modifié par l'utilisateur)** |
| D9 | Cache L1 mémoire + L2 Redis facultatif (stockage Nitro) ; révisions en base ; SQLite en WAL | **validé** |
| D10 | Vitest | **validé** |
| D11 | Dossiers **conservés** (regroupement, filtre, navigation), implémentés en B5 ; étiquettes plus tard | **validé** |
| D12 | Livraison par sous-étapes validées et commitées une à une (désormais B1 → B5) | **validé** |
| D13 | Environnements = étiquette sur les clés d'un même projet ; environnement jetable = projet séparé | **validé** |
| D14 | « Déplacer » en plus de « Dupliquer » ; suppression de projet : archivage préalable puis choix « vers la bibliothèque » ou « suppression définitive » | **validé** |
| D15 | Transformations : grammaire et paramètres § 10, format par l'extension, ordre fixe, forme canonique, politique par projet (`open` borné par défaut), liens signés v2 dès B3 | **validé** |

## 17. Hors périmètre (évolutions possibles, schéma compatible)

Webhooks par projet (invalidation des caches côté client) · comptes de service multi-projets · OAuth 2.1 (applications
agissant au nom d'utilisateurs surgeMedia) · accès en lecture à la bibliothèque pour les identifiants d'un projet ·
restriction IP des clés secrètes · quotas par projet (stockage, envois) · étiquettes · textes alternatifs par contexte ·
déduplication physique des fichiers dupliqués · détection des doublons à l'envoi · purge CDN par fournisseur · envoi
depuis une URL (avec protection SSRF) · négociation de format (`auto`) · authentification unique (SSO) pour
l'administration.
