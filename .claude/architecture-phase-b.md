# Phase B — Projets, médias partagés, jetons d'accès et cache

> **Statut : PROPOSITION en attente de validation.** Aucun code n'a été modifié.
> Rédigée le 2026-09-28 à partir de l'état décrit dans `.claude/project-context.md` (commit `c505758`).
> Une fois validée et amendée, elle devient la référence d'implémentation ; les décisions retenues seront
> reportées dans `project-context.md` et `setup.md`. Les points à trancher sont récapitulés en § 13.

---

## 0. Résumé en 12 points

1. **Une installation = une organisation cliente** (auto-hébergement) : pas de couche multi-locataire.
2. Un média existe **une seule fois** et possède des **rattachements** : la **bibliothèque de l'organisation**
   (drapeau) et/ou **0..n projets** (table de liaison). Bibliothèque sans projet = « bibliothèque globale ».
   Plus aucun rattachement = corbeille.
3. **Règle unique de modification** : modifier, remplacer ou supprimer un média exige le droit correspondant sur
   **tous** ses rattachements. Retirer un média d'un projet n'exige que les droits sur ce projet.
4. **Un rôle = un ensemble de portées.** Même vocabulaire pour les humains et les jetons ; un jeton ne dépasse
   jamais les droits de ce qui l'a émis.
5. Rôles de plateforme conservés (ADMIN, DEVELOPER, EDITOR) + **rôles de projet** (OWNER, DEVELOPER, EDITOR) ;
   le rôle de plateforme sert de **plafond**.
6. **Cinq identifiants + deux accès sans jeton** : session d'administration, jeton personnel `sm_pat_`, clé secrète
   de projet `sm_sk_`, clé publique de projet `sm_pk_`, jeton délégué éphémère `sm_dt_`, lien signé, accès public.
7. **Aucun secret durable dans un navigateur** : le navigateur utilise une clé publique (lecture de médias publics)
   ou un jeton délégué de quelques minutes émis par le backend du client.
8. **Le projet est explicite dans chaque URL d'API** (`/api/v1/projects/{id}/…`) : cloisonnement, CORS par projet
   dès le preflight, clés de cache naturelles.
9. **Toutes les requêtes sont cloisonnées côté serveur** à partir de l'identité, jamais à partir des filtres
   envoyés ; un média hors périmètre répond **404** (son existence n'est pas révélée).
10. **La diffusion (`/m/…`) reste indépendante des projets et sans cookie** : public, lien signé ou Bearer —
    compatible CDN.
11. **Cache par générations** (compteurs de révision) : pas de purge fragile ; liens signés **alignés sur des tranches
    de temps** pour rester cachables.
12. Livraison en **4 sous-étapes (B1 → B4)** validées séparément, avec des **tests automatisés** du moteur
    d'autorisation (la partie la plus critique).

## 1. Analyse de l'idée initiale

**Repris tel quel** : plusieurs projets par client ; un média utilisable par 0, 1 ou n projets ; une application
travaillant avec le projet A ne voit que les médias autorisés pour A ; sécurité appliquée côté serveur ; API
consommable par tous les frameworks ; composants `<MediaPicker>`, `<MediaLibrary>`, `<MediaUpload>` ; jetons fins ;
cache sur toutes les couches.

**Amélioré / adapté** :

| Idée initiale | Proposition | Pourquoi |
| --- | --- | --- |
| « Aucun projet = bibliothèque globale » | La bibliothèque est un **rattachement explicite** (drapeau), cumulable avec des projets | Sinon, rattacher un logo à un projet le retirerait de la bibliothèque pour tous les autres, et retirer un média de son dernier projet le rendrait « global » par accident |
| « Un média peut appartenir à plusieurs projets » | Oui, mais **un média partagé ne peut être modifié que par qui a les droits sur tous ses rattachements** | Le projet A ne doit pas pouvoir casser le projet B (passer une image en privé, la remplacer, la supprimer) |
| 9 cas d'usage de jetons | **5 types d'identifiants** couvrent les 9 cas ; « administrateur » et « propriétaire » sont des **rôles**, pas des types de jetons | Moins de types = moins de chemins de code sensibles, un seul moteur d'autorisation |
| Jeton pour l'application frontend et le composant Upload | **Clé publique** (non secrète, lecture publique) + **jeton délégué** éphémère émis par le backend du client | Tout ce qui est livré à un navigateur est public : aucun secret durable ne doit y figurer |
| Filtrer les médias par projet | Le projet fait partie du **chemin** de l'API et du **périmètre de la requête SQL** | Isolation garantie par construction, pas par un paramètre facultatif |
| Cache des listes, URL, métadonnées… | **Invalidation par versions** (URL versionnées, compteurs de révision, tranches de signature) | Aucune purge à orchestrer, cohérent en multi-instance |

**Inchangé** (étape 4) : stockage (`MediaStorage` / Flydrive), pipeline d'envoi (busboy, détection de type,
sharp), URL de diffusion versionnées et immuables, dérivés persistés, liens signés HMAC, corbeille.

## 2. Modèle conceptuel

```text
Installation (= organisation cliente)
├─ Utilisateurs ─── rôle de plateforme : ADMIN | DEVELOPER | EDITOR
├─ Bibliothèque de l'organisation ◄──────────────┐
├─ Projets ─── membres (OWNER | DEVELOPER | EDITOR), clés d'API, origines CORS, réglages
│     └─ rattachements (ProjectMedia) ───────────┤
└─ Médias ─── fichier, versions, dérivés, métadonnées, visibilité (PUBLIC | PRIVATE)
              rattachements = { bibliothèque ? } ∪ { projets 0..n }
```

Exemples :

| Média | Bibliothèque | Projets | Qui le voit |
| --- | :---: | --- | --- |
| Logo de la marque | ✓ | A, B | tous les utilisateurs ; identifiants de A et de B |
| Photo de campagne | – | A | membres de A ; identifiants de A |
| Visuel commun | – | A, B | membres de A ou de B ; identifiants de A et de B |
| Archive | ✓ | – | tous les utilisateurs ; aucun identifiant de projet (sauf option « accès à la bibliothèque ») |
| — | – | – | **corbeille** (état interdit pour un média actif) |

L'ADMIN voit tout.

### Règles

- **R1 — Rattachement obligatoire.** Un média actif a au moins un rattachement. Retirer le dernier le met à la
  corbeille ; ce rattachement est conservé pour que la restauration le remette à sa place.
- **R2 — Lecture.** Un principal lit M s'il a `media:read` sur au moins un rattachement de M **dans le contexte de
  la requête** : via l'API d'un projet, uniquement si M est rattaché à ce projet.
- **R3 — Modification.** Modifier les métadonnées, changer la visibilité, remplacer le fichier, mettre à la corbeille
  ou supprimer définitivement exige le droit correspondant sur **tous** les rattachements de M. L'ADMIN passe toujours.
  Conséquence : les identifiants d'un projet ne peuvent modifier que les médias **exclusifs** à ce projet.
- **R4 — Rattacher / détacher.** Rattacher M à un espace X demande de pouvoir lire M (via l'un de ses rattachements)
  et `media:write` sur X. Détacher M de X demande `media:delete` sur X seulement (R1 s'applique ensuite).
- **R5 — Visibilité.** Public/privé est une propriété du média (une URL sert tous les projets). Pas de visibilité par projet.
- **R6 — Diffusion.** Un média public est servi sans condition de projet ; un média privé exige une preuve : lien
  signé, ou jeton habilité sur l'un de ses rattachements.
- **R7 — Envoi.** Un média envoyé dans le contexte d'un projet y est rattaché ; envoyé dans la bibliothèque, il y
  est rattaché. Provenance conservée (utilisateur ou identifiant, sujet final éventuel).
- **R8 — Confidentialité entre projets.** Aucune réponse ne révèle les autres rattachements d'un média (seul un
  indicateur « modifiable ou non » est renvoyé).

## 3. Rôles et portées

### 3.1 Vocabulaire des portées (commun aux humains et aux jetons)

| Portée | Espace | Autorise |
| --- | --- | --- |
| `media:read` | projet / bibliothèque (`library:read`) | lister, chercher, lire les métadonnées, obtenir les URL (signées si privé) |
| `media:upload` | projet / bibliothèque (`library:upload`) | créer des médias (envoi) |
| `media:write` | projet / bibliothèque (`library:write`) | métadonnées, visibilité, remplacement, rattacher (R3, R4) |
| `media:delete` | projet / bibliothèque (`library:delete`) | détacher, corbeille, restauration, suppression définitive (R3) |
| `project:read` | projet | voir le projet |
| `project:credentials` | projet | clés publiques/secrètes, origines CORS |
| `project:members` | projet | gérer les membres |
| `project:settings` | projet | nom, description, options, archivage, suppression |
| `projects:create` | plateforme | créer des projets |
| `tokens:personal` | plateforme | créer ses propres jetons personnels |
| `users:manage` | plateforme | gérer les comptes |

### 3.2 Rôles de plateforme (`User.role`, sémantique de l'étape 2 conservée)

| Rôle | Bibliothèque | Projets | Jetons personnels | Utilisateurs |
| --- | --- | --- | --- | --- |
| ADMIN | tout | **tous**, comme OWNER implicite ; création | ✓ | ✓ |
| DEVELOPER | tout | ceux dont il est membre ; **création** (devient OWNER) | ✓ | – |
| EDITOR | tout | ceux dont il est membre | – | – |

### 3.3 Rôles de projet (`ProjectMember.role`)

| Rôle | Portées |
| --- | --- |
| OWNER | `project:*` + `media:*` |
| DEVELOPER | `project:read`, `project:credentials`, `media:*` |
| EDITOR | `project:read`, `media:*` |

- **Plafond** : rôle de projet effectif = min(rôle de projet, plafond du rôle de plateforme). Un EDITOR de plateforme
  ne peut être qu'EDITOR dans un projet ; un DEVELOPER peut être OWNER. Rétrograder un utilisateur réduit donc
  immédiatement ses droits dans tous ses projets.
- **Invariant `LAST_OWNER`** (409) : on ne peut ni retirer ni rétrograder le dernier OWNER d'un projet (l'ADMIN reste
  toujours capable d'administrer un projet orphelin, par exemple après la suppression d'un compte).

### 3.4 Droits effectifs (principe du moteur)

```text
portées(principal, espace) =
  session           → portées du rôle (plafonné) dans l'espace
  jeton personnel   → portées du jeton ∩ portées actuelles de son propriétaire dans l'espace
                      (∅ si l'espace n'est pas dans la sélection du jeton)
  clé secrète       → portées de la clé si espace = son projet, sinon ∅
  clé publique      → { media:read } restreint aux médias PUBLIC, si espace = son projet
  jeton délégué     → portées du jeton ∩ portées actuelles de l'émetteur, si espace = son projet
```

**Principe « les jetons ne gèrent jamais les accès »** : aucune portée de jeton ne permet de gérer des utilisateurs,
des membres, des clés, des origines ou les réglages d'un projet (seule exception : l'émission de jetons délégués,
strictement plus restreints et éphémères). Une fuite de jeton ne peut donc pas s'auto-entretenir.

## 4. Identifiants et jetons

### 4.1 Les sept mécanismes

| Mécanisme | Format | Porteur / où il vit | Périmètre | Portées possibles | Durée | Stockage serveur |
| --- | --- | --- | --- | --- | --- | --- |
| **Session d'administration** | cookie scellé (existant) | navigateur, HttpOnly | selon rôles | selon rôles | 12 h | table `Session` |
| **Jeton personnel (PAT)** | `sm_pat_…` | poste du développeur, CI, scripts | ses projets : sélection ou « tous mes projets » | ⊆ `media:*`, `project:read`, `library:*` | **obligatoire** : 30 / 90 / 365 j (90 par défaut) | empreinte SHA-256 |
| **Clé secrète de projet** | `sm_sk_…` | variables d'environnement d'un serveur | **un** projet | ⊆ `media:*` (+ `library:read` si option projet) | facultative (1 an recommandé) | empreinte SHA-256 |
| **Clé publique de projet** | `sm_pk_…` | code frontend (publique par nature) | **un** projet, origines autorisées | `media:read` sur médias PUBLIC uniquement (fixe) | illimitée, révocable | empreinte + valeur (non secrète, réaffichable) |
| **Jeton délégué** | `sm_dt_<charge>.<signature>` | mémoire du navigateur (composant) | **un** projet | ⊆ portées de l'émetteur | 1 à 60 min (15 par défaut) | aucun (signé) ; compteur d'envois éventuel |
| **Lien signé** | `?exp&kid&sig` (existant, étendu) | URL (`<img src>`) | un média, une version, un dérivé | lecture de ce fichier | 60 s à 7 j | aucun |
| **Accès public** | — | — | médias PUBLIC | lecture du fichier | permanent (URL versionnée) | — |

### 4.2 Cas d'usage demandés → mécanisme

| Cas | Mécanisme recommandé | Détail |
| --- | --- | --- |
| Administration de la plateforme | **Session** (humain) ; **PAT d'un ADMIN** pour l'automatisation | la gestion des utilisateurs et des accès reste réservée à l'interface (principe § 3.4) |
| Développeur sur un ou plusieurs projets | **Session** + **PAT** limité aux projets choisis | ses droits suivent son compte : désactivé ou retiré d'un projet → le PAT perd l'accès immédiatement |
| Propriétaire d'un projet | **Rôle OWNER** (session, PAT) | seul à gérer membres et réglages ; crée et révoque toutes les clés du projet |
| Application frontend (site public) | **Clé publique** | lecture des médias PUBLIC du projet ; liste/recherche seulement si l'option « liste publique » est activée ; origines contrôlées |
| Application frontend (espace connecté, médias privés) | **Jeton délégué** `media:read` émis par le backend du client | le backend authentifie son utilisateur, puis demande un jeton de 15 min |
| Composant Upload | **Jeton délégué** `media:upload` + contraintes | nombre de fichiers, taille, types, visibilité imposée, origine ; aucun secret dans le navigateur |
| MediaPicker / MediaLibrary dans un back-office client | **Jeton délégué** (`media:read` [+ `upload`, `write`, `delete`, `library:read`]) | renouvelé par le composant via un rappel `getToken()` |
| Application cliente externe | serveur : **clé secrète dédiée** (portées minimales, révocable seule) ; mobile/desktop : **clé publique + jetons délégués** ; au nom d'utilisateurs surgeMedia : OAuth 2.1 (plus tard) | une clé par intégration pour pouvoir en couper une sans toucher aux autres |
| API backend | **Clé secrète** | refusée si utilisée depuis un navigateur ; rotation avec période de recouvrement |
| Accès public à un média | **Aucun jeton** | URL versionnée immuable, CDN |
| Accès temporaire à un média privé | **Lien signé** | émis par l'interface, une clé secrète, un PAT (ou automatiquement dans les réponses de l'API) |

### 4.3 Format des jetons opaques (PAT, clés)

- `sm_<type>_<corps>` avec `<type>` ∈ `pat`, `sk`, `pk` ; `<corps>` = 32 octets aléatoires en base62 (43 caractères)
  suivis d'un **CRC32 en base62** (6 caractères), à la manière des jetons GitHub.
  - Le CRC permet de rejeter **sans accès à la base** les jetons mal formés ou inventés (protection contre les
    inondations de requêtes) et rend les fuites détectables par les outils d'analyse de secrets (préfixe + somme).
  - Ce n'est pas une protection cryptographique : la sécurité vient des 256 bits aléatoires.
- Stockage : **SHA-256** du jeton (index unique). Pas d'argon2 : le jeton a 256 bits d'entropie (pas d'attaque par
  dictionnaire) et doit être vérifié à chaque requête. Préfixe lisible conservé (`sm_sk_4fQ9Zt…`) pour l'affichage.
- Le jeton complet n'est affiché **qu'une fois** (sauf la clé publique, non secrète). Jamais accepté dans une URL
  (`?access_token=` refusé : journaux, en-tête Referer) ; uniquement `Authorization: Bearer`.
- **Pourquoi opaque et pas JWT pour les jetons durables** : révocables instantanément, courts, ne transportent aucune
  donnée lisible. Les formats signés sans état sont réservés aux preuves **courtes** (jeton délégué, lien signé).

### 4.4 Cycle de vie

- **Création** : nom, projet(s), portées (préréglages « lecture seule », « lecture et envoi », « complet »), expiration.
  Confirmation du mot de passe demandée si la dernière saisie date de plus de 10 min (« mode sudo », recommandé)
  pour créer une clé secrète ou un PAT et pour modifier les membres.
- **Portées immuables** après création : pour changer, on crée un nouvel identifiant (traçabilité simple).
- **Rotation** d'une clé secrète : « Renouveler » crée la nouvelle clé ; l'ancienne reste valable pendant une période
  de recouvrement choisie (immédiat, 1 h, 24 h, 7 j) puis expire.
- **Révocation** immédiate (`revokedAt`) ; propagation instantanée sur l'instance, ≤ 60 s sur les autres (§ 8.6).
  Révoquer un émetteur invalide tous ses jetons délégués.
- **Dernière utilisation** (date, IP) enregistrée au plus toutes les 5 min (pas d'écriture à chaque requête).
- **Désactivation d'un utilisateur** → ses PAT cessent immédiatement de fonctionner ; ses clés secrètes et publiques
  de projet **restent actives** (elles appartiennent au projet), l'interface signale « créée par un compte désactivé ».
- **Archivage d'un projet** → toutes ses clés et tous ses jetons délégués sont refusés ; médias en lecture seule.
  **Suppression** → liens, clés, origines, membres supprimés ; les médias qui n'ont plus de rattachement passent en
  corbeille (R1), ce qui reste réversible.

### 4.5 Jetons délégués (composants dans le navigateur)

Émission par le backend du client (clé secrète ou PAT) :

```http
POST /api/v1/projects/{projectId}/delegated-tokens
Authorization: Bearer sm_sk_…
{ "scopes": ["media:upload"], "expiresIn": 600, "subject": "user-42",
  "origin": "https://app.example.com",
  "upload": { "maxFiles": 5, "maxSize": 10485760, "types": ["image/jpeg", "image/png"], "visibility": "private" } }
→ 201 { "token": "sm_dt_eyJ2Ijox….Q2x…", "expiresAt": "2026-09-28T14:10:00Z" }
```

- Charge utile (base64url, lisible par le composant pour anticiper l'expiration) : version, `jti`, émetteur, projet,
  portées, sujet final (identifiant opaque de l'application cliente, pour l'audit), échéance, origine, contraintes.
- Signature HMAC-SHA256 avec une clé **dérivée** du secret de signature (séparation des usages) et un `kid` (rotation).
- Vérification à chaque usage : signature, échéance, émetteur toujours valide (en cache), projet actif, origine,
  contraintes. `maxFiles` est garanti par un compteur (`DelegatedTokenUsage`, incrément conditionnel atomique).
- Un jeton délégué ne peut ni émettre d'autres jetons ni générer de liens signés (les réponses contiennent déjà des
  URL signées courtes). Pas de révocation individuelle : durée courte, ou révocation de l'émetteur.

```text
Navigateur <MediaUpload>          Backend du client (sm_sk_…)               surgeMedia
   │ 1. « puis-je envoyer ? » ─────►│ (authentifie SON utilisateur)           │
   │                                │ 2. POST …/delegated-tokens ────────────►│ vérifie la clé, les portées
   │                                │◄──────────── { token: sm_dt_…, exp } ───│
   │◄──────────── sm_dt_… ──────────│                                         │
   │ 3. POST /api/v1/projects/P/media (multipart, Bearer sm_dt_…) ───────────►│ preflight CORS (origines de P),
   │    progression (XHR)                                                     │ signature, émetteur, origine,
   │◄───────────────────────────────── 201 { média rattaché à P } ────────────│ contraintes, analyse du fichier
```

### 4.6 Liens signés (évolutions de l'existant)

- Signature inchangée sur (média, version, dérivé, échéance), plus un **`kid`** : le secret peut être changé en gardant
  l'ancien pour la vérification pendant la durée maximale des liens (7 j).
- **Échéance alignée sur des tranches** (§ 8.5) pour que les URL restent identiques et cachables.
- Les réponses de l'API contiennent directement des URL signées (durée par défaut 1 h) pour les médias privés, quand
  l'identifiant a le droit de les lire.

### 4.7 Garde-fous

- Clé secrète ou PAT reçu avec un en-tête `Origin` ou `Sec-Fetch-Site` (donc depuis un navigateur) → 403
  `SECRET_IN_BROWSER` : empêche l'erreur classique d'une clé secrète dans le code frontend.
- L'API v1 **n'accepte pas les cookies** : pas de CSRF possible, pas de confusion avec la session d'administration.
- Clé publique : lecture de médias publics seulement ; l'origine est vérifiée **côté serveur** en plus du CORS (anti-abus,
  pas une frontière de sécurité, puisque tout client hors navigateur peut forger `Origin`).
- Limitation de débit par identifiant et par IP (§ 6.7) ; échecs d'authentification comptés par IP.
- En-tête `Authorization` masqué dans les journaux ; journal d'audit des actions sensibles (§ 9).

## 5. Application côté serveur

### 5.1 Identité unique (« principal »)

```ts
type Principal =
  | { kind: 'user', via: 'session' | 'pat', user: AuthUser, token?: TokenRef }
  | { kind: 'project-key', keyType: 'publishable' | 'secret', projectId: string, scopes: Scope[], token: TokenRef }
  | { kind: 'delegated', projectId: string, scopes: Scope[], issuer: TokenRef, subject?: string, constraints: DelegatedConstraints }
  | { kind: 'anonymous' }
```

Résolution selon la route : cookie pour `/api/admin/**` (existant) ; `Authorization: Bearer` pour `/api/v1/**` et
`/m/**`. Résultat mis en cache dans `event.context.principal`.

### 5.2 Moteur d'autorisation

- Module **pur** (sans accès réseau) : `scopesIn(principal, espace)`, `canRead(principal, media, contexte)`,
  `canModify(principal, media + rattachements, action)`. Testé de façon exhaustive (matrice rôles × espaces × actions).
- Les routes appellent `requireAccess(event, action, ressource)` → 401 / 403 / 404. `requireAuth(event, permission)`
  reste pour les permissions de plateforme (`users:manage`…).

### 5.3 Requêtes cloisonnées

Les listes et lectures ne partent **jamais** d'un filtre client : `scopedMediaQuery(principal, projectId)` produit la
condition de base (lien `ProjectMedia` avec ce projet, `deletedAt: null`, `visibility: PUBLIC` pour une clé publique,
restrictions du jeton délégué) à laquelle les filtres de la requête sont **ajoutés** (ET). Une lecture par identifiant
passe par le même chemin : média inexistant ou hors périmètre → même **404**.

### 5.4 Codes d'erreur ajoutés

401 `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_REVOKED` · 403 `INSUFFICIENT_SCOPE`, `MEDIA_SHARED`
(R3), `ORIGIN_NOT_ALLOWED`, `SECRET_IN_BROWSER`, `PROJECT_ARCHIVED`, `UPLOAD_LIMIT_REACHED` · 404 `PROJECT_NOT_FOUND`,
`MEDIA_NOT_FOUND` · 409 `LAST_OWNER`, `SLUG_TAKEN` · 429 `RATE_LIMITED`.

### 5.5 Organisation du code (prévue)

- `shared/utils/scopes.ts` : vocabulaire des portées, rôles → portées, plafonds (auto-importé, utilisé aussi par l'UI).
- `server/lib/access/` : `principal.ts` (résolution), `policy.ts` (moteur pur), `tokens.ts` (format, CRC, empreinte,
  vérification), `delegated.ts` (émission, vérification).
- `server/lib/projects/` : projets, membres, rattachements, révisions.
- `server/lib/cache/` : cache à deux niveaux, compteurs de révision.
- `server/api/v1/**` (routes publiques), `server/middleware/api-v1.ts` (CORS, identité, limitation de débit).
- `server/lib/media/*` : les services reçoivent un principal et un contexte (projet ou bibliothèque) ; plus de
  `defaultProjectId()`.

## 6. API v1 (applications tierces)

### 6.1 Principes

- REST + JSON, préfixe **`/api/v1`**, évolutions uniquement additives (rupture = `/api/v2`).
- **Projet explicite dans le chemin** : isolation lisible, preflight CORS résolu sans en-tête `Authorization` (les
  navigateurs ne l'envoient pas au preflight), clés de cache et journaux par projet, PAT multi-projets possible.
  Une clé utilisée sur un autre projet que le sien reçoit 404.
- Contrat public **indépendant de l'administration** : valeurs en minuscules (`"image"`, `"public"`), URL
  **absolues** (base `NUXT_MEDIA_PUBLIC_URL`, jamais déduite de l'en-tête `Host`), ni e-mails ni chemins physiques.
- Spécification **OpenAPI 3.1** générée depuis les schémas zod partagés (`z.toJSONSchema`) : `/api/v1/openapi.json`.

### 6.2 Points d'accès

| Méthode et chemin | Portée | Identifiants |
| --- | --- | --- |
| `GET /api/v1/me` | — | tous : type d'identifiant, projet(s), portées, expiration (les composants s'adaptent) |
| `GET /api/v1/projects` | `project:read` | PAT (ses projets), clés et jetons délégués (leur projet) |
| `GET /api/v1/projects/{p}` | `project:read` | idem |
| `GET /api/v1/projects/{p}/media` | `media:read` | tous ; clé publique : si « liste publique » activée, médias PUBLIC |
| `GET /api/v1/projects/{p}/media/{id}` | `media:read` | tous (clé publique : PUBLIC seulement) |
| `POST /api/v1/projects/{p}/media` | `media:upload` | clé secrète, PAT, jeton délégué — multipart, rattaché à `p` |
| `PATCH /api/v1/projects/{p}/media/{id}` | `media:write` + R3 | clé secrète, PAT, jeton délégué |
| `PUT /api/v1/projects/{p}/media/{id}/file` | `media:write` + R3 | idem |
| `DELETE /api/v1/projects/{p}/media/{id}` | `media:delete` | idem — **détache** de `p` (corbeille si dernier rattachement, R1) |
| `POST /api/v1/projects/{p}/media/{id}/signed-url` | `media:read` | clé secrète, PAT — `{ expiresIn, variant }` |
| `GET /api/v1/projects/{p}/library` | `library:read` | si option « accès à la bibliothèque » du projet (ou PAT) |
| `POST /api/v1/projects/{p}/media/attach` | `media:write` + `library:read` | rattacher des médias de la bibliothèque (`{ mediaIds }`) |
| `POST /api/v1/projects/{p}/delegated-tokens` | portées demandées ⊆ émetteur | clé secrète, PAT |
| `GET\|HEAD /m/…` | — | public, lien signé, ou Bearer habilité (R6) |

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
  "url": "https://media.example.com/m/cm1q…/v3/affiche-ete.jpg?exp=1790000000&kid=1&sig=…",
  "previewUrl": "https://media.example.com/m/cm1q…/v3/preview/affiche-ete.webp?exp=…&kid=1&sig=…",
  "urlExpiresAt": "2026-09-28T15:00:00Z",
  "editable": false,
  "addedAt": "2026-09-20T09:12:00Z",
  "createdAt": "2026-09-18T16:40:00Z",
  "updatedAt": "2026-09-27T11:02:00Z"
}
```

`urlExpiresAt` vaut `null` pour un média public ; `editable` reflète R3 pour l'identifiant courant (sans révéler
les autres rattachements) ; `addedAt` = date de rattachement au projet.

### 6.4 Listes, recherche, pagination

- Paramètres : `q`, `kind`, `visibility`, `ids` (≤ 100 : réhydratation des sélections d'un MediaPicker), `sort`
  (`newest` | `oldest` | `name` | `size`), `limit` (1–100, 24 par défaut), `cursor`, `withTotal`.
- **Pagination par curseur** (keyset, curseur opaque) : coût constant quelle que soit la profondeur, stable pendant les
  ajouts ; `total` seulement sur demande (un COUNT est coûteux sur de gros volumes). L'administration garde ses numéros
  de page.
- Réponse : `{ "items": Media[], "nextCursor": string | null, "total"?: number }`.

### 6.5 Erreurs (RFC 9457 « Problem Details »)

```json
{ "type": "…/errors#MEDIA_SHARED", "title": "Media is shared", "status": 403, "code": "MEDIA_SHARED",
  "detail": "This media is attached to other spaces and cannot be modified with this credential.",
  "instance": "/api/v1/projects/…/media/…", "requestId": "…" }
```

`code` est stable et sert aux composants pour **traduire** le message (fr/en) ; `title`/`detail` sont destinés aux
développeurs. L'administration garde son format actuel (`data.code`).

### 6.6 CORS (par projet)

- Origines autorisées du projet (`AllowedOrigin`) : correspondance exacte `schéma://hôte[:port]`, plus sous-domaines
  génériques `https://*.example.com` (déploiements de prévisualisation).
- Preflight `OPTIONS /api/v1/projects/{p}/…` : origine autorisée → `Access-Control-Allow-Origin: <origine>`,
  `-Allow-Methods`, `-Allow-Headers: Authorization, Content-Type, If-None-Match`, `-Max-Age: 7200`, `Vary: Origin` ;
  sinon aucun en-tête CORS (le navigateur bloque). Jamais `Allow-Credentials` (pas de cookies).
- Réponses : mêmes en-têtes + `Access-Control-Expose-Headers: ETag, RateLimit, RateLimit-Policy, Retry-After`.
- Contrôle serveur : clé publique ou jeton délégué avec une origine non autorisée → 403 `ORIGIN_NOT_ALLOWED` ; sans
  `Origin` (serveur, application mobile) : accepté pour la clé publique.
- `/m/…` : `Access-Control-Allow-Origin: *` pour les réponses publiques et signées (usage en `fetch`/`canvas`).

### 6.7 Limitation de débit

Seau à jetons par identifiant (et par IP pour la clé publique), en-têtes `RateLimit` / `RateLimit-Policy` (brouillon
IETF) et `Retry-After`. Valeurs initiales proposées, configurables : clé publique 300 req/min par (clé, IP) ; clé
secrète et PAT 1 200 req/min ; envois 60/min par identifiant ; échecs d'authentification 30/min par IP. Stockage en
mémoire par défaut, partagé (Redis) en multi-instance (§ 8.9).

## 7. Consommation par les frontends et composants

- **`@surge-media/client`** (TypeScript, sans framework, basé sur `fetch`, navigateur / Node / edge) : client typé de
  l'API v1, gestion de l'identifiant (clé publique ou rappel `getToken()` renouvelant les jetons délégués avant
  expiration), itérateurs de pagination, envoi avec progression, traduction des codes d'erreur, aides d'URL
  (`srcset` en phase C).
- **Logique des composants sans interface** dans ce paquet (état du sélecteur, file d'envoi, sélection), puis liaisons
  fines **`@surge-media/vue` / `react` / `svelte`** : la logique n'est écrite qu'une fois. Composants accessibles
  (WCAG 2.2 AA) et traduits (fr/en), comme l'administration.

| Composant | Contexte | Identifiant |
| --- | --- | --- |
| `<MediaImage>` | tout site | aucun (URL publique) ou URL signée fournie par le backend |
| `<MediaLibrary>` en lecture sur un site public | galerie | clé publique (option « liste publique ») |
| `<MediaPicker>` / `<MediaLibrary>` dans un back-office | choix, gestion | jeton délégué via `getToken()` |
| `<MediaUpload>` | formulaires, back-office | jeton délégué `media:upload` + contraintes |

Le choix est stocké par l'application cliente sous forme d'**identifiant de média** (stable, indépendant des versions),
puis réhydraté par `GET …/media?ids=…`.

## 8. Performance et cache

**Principe** : le chemin le plus sollicité est la **diffusion des fichiers**, puis la **lecture des listes** par les
frontends ; les écritures sont rares. On rend donc la diffusion cachable par un CDN et le plus souvent sans base, les
lectures d'API revalidables à moindre coût (304), et l'on invalide **par versions** plutôt que par purge.

### 8.1 Fichiers statiques (originaux et dérivés)

- URL versionnées immuables (existant) : `public, max-age=31536000, immutable` ; remplacement = nouvelle URL.
- **CDN devant `/m/`** et `NUXT_MEDIA_PUBLIC_URL` (domaine de diffusion utilisé pour les URL absolues de l'API).
- **Domaine de diffusion séparé et sans cookie recommandé** (ex. `media.example.com`) : aucun cookie envoyé avec chaque
  image, contenu envoyé par des tiers isolé de l'origine de l'administration.
- **`/m/` sans cookie** : l'administration affiche les aperçus privés et la corbeille par liens signés courts au lieu
  de la session ; la diffusion devient entièrement sans état.
- Requêtes partielles **`Range` (206)** + `Accept-Ranges` (nécessaires aussi pour la vidéo, phase D), `Last-Modified`,
  304 (existant), flux sans mise en mémoire (existant).
- Plus tard, option S3 « redirection » : 302 vers une URL pré-signée courte du bucket (décharge la bande passante, mais
  perd nos en-têtes de sécurité).
- **Limite assumée** : passer un média public en privé ou le mettre à la corbeille n'efface pas les copies déjà en
  cache (navigateurs, CDN). Adaptateur facultatif de **purge CDN** (`CdnPurger` : aucun, webhook, fournisseur) ;
  l'interface l'indique lors du changement.

### 8.2 Miniatures et dérivés

- Générés une fois, persistés (`MediaVariant`), immuables (existant) ; déduplication des générations simultanées
  (existant, contrainte d'unicité en multi-instance).
- **Pré-génération de l'aperçu** en tâche de fond juste après l'envoi : pas de latence au premier affichage.
- **Concurrence de sharp bornée** (sémaphore ≈ nombre de cœurs, file d'attente) ; file saturée → 503 + `Retry-After`
  plutôt qu'un serveur à genoux.
- Cache mémoire « (média, version, dérivé) → clé de stockage » : pas de requête `MediaVariant` à chaque affichage.
- Phase C : **liste blanche de transformations** (préréglages nommés ou paramètres bornés) contre l'explosion du nombre
  de dérivés (déni de service par tailles arbitraires).

### 8.3 Métadonnées des médias

- Chemin chaud de `/m/` (version, visibilité, corbeille, clé, type, taille, empreinte) : **cache L1 LRU borné**
  (~10 000 entrées), durée 60 s, invalidé localement à chaque écriture.
- Détail API : ETag faible `W/"<id>-<version>-<updatedAt>"` → 304.
- Multi-instance : écart maximal = durée du L1 (voir § 8.9).

### 8.4 Listes et résultats de recherche/filtrage

- **Compteur de révision par espace** (chaque projet, la bibliothèque), incrémenté par toute écriture qui modifie le
  contenu d'une liste (§ 8.8).
- **ETag de liste** = empreinte (espace, révision, requête normalisée, audience, tranche de signature) : un
  `If-None-Match` identique → **304 sans exécuter la requête** (seule la révision est lue, elle-même gardée quelques
  secondes en L1).
- **Cache serveur des résultats** (identifiants + curseur suivant) dont la clé contient la révision : une écriture
  rend les anciennes entrées inaccessibles d'elles-mêmes (cache « générationnel », aucune purge). Les objets médias
  sont reconstitués depuis le cache de métadonnées.
- `total` mis en cache par révision.
- Index : `ProjectMedia(projectId, addedAt, mediaId)`, `ProjectMedia(mediaId)`, `Media(inLibrary, createdAt)`,
  `Media(checksum)`, `Media(deletedAt)`.
- **Recherche normalisée** : colonnes de recherche en minuscules et sans accents (une par champ, ≤ 191 caractères pour
  MySQL), la saisie étant normalisée de la même façon → insensible à la casse **et aux accents** sur les trois bases
  (corrige la limite SQLite connue). Interface `MediaSearch` : implémentation `LIKE` par défaut, implémentations
  natives possibles pour les gros volumes (PostgreSQL `pg_trgm`, MySQL FULLTEXT, SQLite FTS5).
- En-têtes : `Cache-Control: private, no-cache` + ETag par défaut (revalidation → 304). Option de projet « liste publique
  cachable » pour les réponses à clé publique (données publiques) : `public, s-maxage=60, stale-while-revalidate=300`.

### 8.5 URL et liens signés

- URL publiques : calcul pur (aucune base).
- Liens signés HMAC : vérification sans base (existant).
- **Échéance alignée sur des tranches** : pour une durée D, l'échéance est arrondie à la tranche suivante (ex. D = 1 h,
  tranche = 15 min) ; tous les appels d'une même tranche produisent **la même URL** → cache navigateur/CDN efficace et
  ETag de liste stables. Validité réelle entre D et D + tranche.
- Réponse signée : `private, max-age=<reste>` (existant) ; option « partageable » (`public`) pour laisser un CDN la
  garder jusqu'à l'échéance, sans risque puisque l'URL elle-même est la preuve d'accès.

### 8.6 Identifiants, jetons et configuration des projets

- Jeton opaque : format + CRC (sans base) → **cache L1 « empreinte → identité »** (60 s, invalidé localement à la
  révocation) → base.
- Jeton délégué : signature vérifiée sans base ; état de l'émetteur lu dans le même cache.
- Origines autorisées et réglages de projet : L1 60 s ; preflights gardés par le navigateur (`Access-Control-Max-Age`).
- `lastUsedAt` écrit au plus toutes les 5 min.

### 8.7 Récapitulatif

| Donnée | Où | Clé | Durée | Invalidation |
| --- | --- | --- | --- | --- |
| Fichier public (original, dérivé) | navigateur, CDN | URL versionnée | 1 an, immuable | nouvelle version ; purge CDN facultative |
| Fichier privé signé | navigateur (CDN en option) | URL signée (tranche) | jusqu'à l'échéance | échéance ; nouvelle version |
| Aperçu / dérivé généré | stockage + `MediaVariant` | (média, version, transformation) | permanent | nouvelle version (suppression des anciens) |
| Métadonnées de diffusion | L1 (+ L2) | `media:<id>` | 60 s | écriture sur le média |
| Clé de dérivé | L1 | `variant:<id>:<v>:<t>` | 10 min | nouvelle version |
| Liste / recherche | L1 (+ L2) + ETag client | espace + révision + requête + audience | 5 min | révision de l'espace (automatique) |
| Détail média (API) | ETag client | id + version + updatedAt | revalidation | modification |
| Identité d'un jeton | L1 (+ L2) | empreinte | 60 s | révocation |
| Réglages et origines d'un projet | L1 | `project:<id>` | 60 s | modification |
| Preflight CORS | navigateur | origine + URL | 2 h | — |

### 8.8 Invalidation : événement → action

| Événement | Actions |
| --- | --- |
| Envoi dans un espace | révision de l'espace + 1 ; pré-génération de l'aperçu |
| Métadonnées, visibilité, remplacement, corbeille, restauration de M | révision de **tous** les espaces de M + 1 ; L1 `media:<id>` ; purge CDN si public → privé ou corbeille |
| Rattachement / détachement de M | révision de **tous** les espaces de M (anciens et nouveaux) + 1 (l'indicateur `editable` change) |
| Révocation / expiration forcée d'un identifiant | L1 de l'identité |
| Origines, réglages, archivage d'un projet | L1 `project:<id>` |
| Changement de rôle, désactivation, retrait d'un membre | aucune (droits recalculés à chaque requête ; PAT : L1 60 s) |

### 8.9 Infrastructure

- **Cache à deux niveaux** : L1 en mémoire (LRU borné, par processus) ; L2 facultatif via le **stockage Nitro**
  (unstorage, déjà embarqué par Nitro : aucune nouvelle dépendance), pilote Redis/Valkey activé par variables
  d'environnement. Le même stockage partagé sert à la limitation de débit en multi-instance.
- Compteurs de révision **en base** (source de vérité partagée entre instances), relus au plus toutes les quelques
  secondes.
- **SQLite** : activer le mode **WAL** (lectures concurrentes pendant les écritures ; non activé aujourd'hui).
  PostgreSQL recommandé dès plusieurs instances ou un volume important.
- **Tâches de fond** (tâches Nitro) : pré-génération des aperçus, purge des compteurs de jetons délégués expirés,
  remplissage des colonnes de recherche, nettoyage des orphelins.

## 9. Modèle de données proposé (Prisma)

```prisma
enum ProjectRole { OWNER DEVELOPER EDITOR }
enum TokenType { PERSONAL SECRET PUBLISHABLE }

model Project {
  id            String    @id @default(cuid())
  name          String
  slug          String    @unique
  description   String?
  /// Les identifiants du projet peuvent parcourir la bibliothèque et y puiser (lecture seule)
  libraryAccess Boolean   @default(false)
  /// La clé publique peut lister/chercher (sinon : lecture par identifiants seulement)
  publicListing Boolean   @default(false)
  archivedAt    DateTime?
  createdById   String?                                   // User, SetNull
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  members ProjectMember[]  media ProjectMedia[]  tokens AccessToken[]  tokenGrants AccessTokenProject[]  allowedOrigins AllowedOrigin[]
}

model ProjectMember {
  projectId String
  userId    String                                        // Cascade des deux côtés
  role      ProjectRole
  createdAt DateTime @default(now())
  @@id([projectId, userId])
  @@index([userId])
}

/// Rattachement d'un média à un projet (la bibliothèque est le drapeau Media.inLibrary)
model ProjectMedia {
  projectId String
  mediaId   String                                        // Cascade des deux côtés
  addedAt   DateTime @default(now())
  addedById String?                                       // User, SetNull
  @@id([projectId, mediaId])
  @@index([projectId, addedAt, mediaId])
  @@index([mediaId])
}

model Media {
  // supprimés : projectId, folderId (et le modèle Folder, inutilisé)
  inLibrary          Boolean @default(false)
  /// Colonnes de recherche normalisées (minuscules, sans accents), remplies par l'application
  searchTitle        String?
  searchName         String  @default("")
  searchAlt          String?
  uploadedById       String?                              // User, SetNull (existant)
  uploadedByTokenId  String?                              // AccessToken, SetNull
  /// Sujet final déclaré par l'application cliente (jeton délégué), pour l'audit
  uploadSubject      String?
  // … champs existants inchangés (kind, visibility, storageKey, version, checksum, deletedAt…)
  @@index([inLibrary, createdAt])
  @@index([checksum])
  @@index([deletedAt])
}

/// Identifiant d'API : jeton personnel, clé secrète ou clé publique de projet
model AccessToken {
  id          String    @id @default(cuid())
  type        TokenType
  name        String
  /// Clés de projet (SECRET, PUBLISHABLE) ; null pour un jeton personnel
  projectId   String?                                     // Cascade
  /// Propriétaire d'un jeton personnel
  userId      String?                                     // Cascade
  /// Jeton personnel : tous les projets de son propriétaire (sinon : AccessTokenProject)
  allProjects Boolean   @default(false)
  prefix      String
  tokenHash   String    @unique
  /// Valeur en clair, uniquement pour une clé publique (non secrète)
  publicValue String?
  scopes      String                                      // séparées par des espaces, immuables
  expiresAt   DateTime?
  lastUsedAt  DateTime?
  lastUsedIp  String?
  revokedAt   DateTime?
  createdById String?                                     // SetNull
  createdAt   DateTime  @default(now())
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

/// Journal d'audit des actions sensibles (jetons, membres, suppressions, visibilité)
model AuditEvent {
  id          String   @id @default(cuid())
  at          DateTime @default(now())
  actorUserId String?
  tokenId     String?
  projectId   String?
  action      String                                      // ex. "token.created", "member.removed"
  targetType  String?
  targetId    String?
  ipAddress   String?
  data        Json?
  @@index([projectId, at])
  @@index([at])
}
```

Toutes ces structures respectent les règles de portabilité (pas de `@db.*`, pas de listes scalaires, chaînes ≤ 191).

## 10. Migration de l'existant

1. **Schéma** (migration pour les 3 fournisseurs, avec reprise de données écrite à la main) :
   - tous les médias existants → `inLibrary = true` (ils étaient visibles de tous les rôles : sémantique conservée) ;
   - suppression de `Media.projectId`, `Media.folderId` et du modèle `Folder` (jamais utilisé ; les dossiers
     reviendront plus tard, **par projet**, portés par `ProjectMedia`) ;
   - suppression du projet technique `default` (aucune clé ni origine n'a pu y être créée) ;
   - `AccessToken` restructuré (table vide aujourd'hui) ;
   - colonnes de recherche remplies par une tâche au démarrage (la suppression des accents n'est pas portable en SQL).
2. **Code** : suppression de `defaultProjectId()` ; permissions `media:manage` / `tokens:manage` / `api:manage`
   remplacées par les portées ; services médias paramétrés par (principal, espace) ; `authorizeDelivery` sans session.
3. **Interface** : la page Médias devient « Bibliothèque » ; les écrans Projets et Jetons remplacent les sections
   « à venir ».

## 11. Interface d'administration

- Barre latérale : Tableau de bord · Bibliothèque · Projets · Jetons personnels · Utilisateurs (filtrée par portées).
- **Projets** : liste (mes projets ; tous pour l'ADMIN), création (nom, identifiant lisible généré, description).
- **Fiche projet** (routes sœurs `/admin/projects/[id]/…`) : Aperçu et réglages · Médias (liste, envoi, « ajouter
  depuis la bibliothèque », retirer) · Membres · Clés d'API (publique, secrètes) · Origines autorisées · Zone sensible
  (archiver, supprimer).
- **Fiche média** : section « Rattachements » (bibliothèque, projets visibles, nombre de projets non visibles),
  avertissement « utilisé par N espaces » avant toute modification, actions désactivées avec explication si R3 n'est
  pas satisfaite.
- **Jetons personnels** : liste, création (nom, expiration, projets, portées), affichage unique, révocation.
- Nouveaux composants probables : onglets de sous-navigation, groupe de cases à cocher (portées), tableau.
  Tout en fr/en, WCAG 2.2 AA, avec les patrons existants (`UiDialog`, `UiCopyField`, `UiRadioCards`, `useFlash`…).

## 12. Découpage et vérification

| Sous-étape | Contenu |
| --- | --- |
| **B1 — Modèle, autorisations, projets** | migrations ; moteur de portées + **tests Vitest** ; projets (création, réglages, archivage) ; membres et rôles ; rattachements dans l'admin ; bibliothèque ; `/m/` sans cookie (aperçus signés) |
| **B2 — Identifiants** | clés publiques et secrètes, PAT, origines CORS (écrans) ; création avec affichage unique, révocation, rotation, dernière utilisation ; confirmation du mot de passe ; journal d'audit |
| **B3 — API v1 en lecture** | résolution de l'identité ; `/me`, projets, liste/détail/`ids`, liens signés ; CORS ; erreurs RFC 9457 ; limitation de débit ; caches (identités, métadonnées, révisions, ETag) ; Bearer sur `/m/` ; OpenAPI ; `Range` |
| **B4 — API v1 en écriture + jetons délégués** | envoi, PATCH/PUT/DELETE (R1–R4) ; rattachement depuis la bibliothèque ; jetons délégués (lecture, envoi, contraintes) ; pré-génération des aperçus ; concurrence sharp bornée |
| Ensuite | `@surge-media/client` + composants (Vue d'abord) ; phase C (transformations) |

À chaque sous-étape : `typecheck`, `i18n:check`, `a11y:contrast`, `db:migration --check`, tests Vitest, build de
production, scénarios d'API rejoués en dev et en prod (y compris les cas de refus : autre projet, portée absente, média
partagé, origine interdite, jeton expiré/révoqué), audit axe fr/en × clair/sombre, `setup.md` et `project-context.md`.

## 13. Décisions à valider

| # | Décision proposée |
| --- | --- |
| D1 | Une installation = une organisation cliente (pas de multi-locataire). |
| D2 | Rattachements : bibliothèque (drapeau) + projets (liaison) ; médias existants → bibliothèque. |
| D3 | Règle unique R3 (droits sur tous les rattachements) ; « supprimer » depuis un projet = détacher, corbeille si dernier rattachement. |
| D4 | Rôles de projet OWNER / DEVELOPER / EDITOR ; rôle de plateforme = plafond ; DEVELOPER de plateforme peut créer des projets ; tous les rôles gèrent la bibliothèque. |
| D5 | Identifiants : PAT, clé secrète **mono-projet**, clé publique, jeton délégué, lien signé ; portées immuables ; aucun jeton ne gère les accès. |
| D6 | Clé publique : médias publics seulement ; liste/recherche publique **désactivée par défaut** (option de projet). |
| D7 | API v1 : projet dans le chemin, cookies refusés, clés secrètes refusées depuis un navigateur, RFC 9457, valeurs en minuscules, pagination par curseur. |
| D8 | `/m/` sans cookie (aperçus d'administration par liens signés) ; `NUXT_MEDIA_PUBLIC_URL` ; domaine de diffusion séparé recommandé. |
| D9 | Cache L1 mémoire + L2 Redis facultatif (stockage Nitro) ; révisions en base ; SQLite en WAL. |
| D10 | Introduction de **Vitest** (dépendance de développement) pour le moteur d'autorisation et les jetons. |
| D11 | Suppression du modèle `Folder` inutilisé (dossiers plus tard, par projet). |
| D12 | Livraison B1 → B4, avec validation et commit entre chaque sous-étape. |

## 14. Hors périmètre (évolutions possibles, schéma compatible)

Webhooks par projet (invalidation des caches côté client) · comptes de service multi-projets · OAuth 2.1 (applications
agissant au nom d'utilisateurs surgeMedia) · restriction IP des clés secrètes · quotas par projet (stockage, envois) ·
dossiers / collections par projet · textes alternatifs propres à un projet · détection des doublons à l'envoi
(proposer de rattacher le média existant) · purge CDN par fournisseur · envoi depuis une URL (avec protection SSRF) ·
authentification unique (SSO) pour l'administration.
