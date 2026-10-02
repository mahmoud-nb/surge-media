# Phase C — Transformations d'images à la demande

> **Statut : VALIDÉE (2026-10-01) — toutes les décisions CD1 à CD12 acceptées par l'utilisateur. PHASE TERMINÉE (2026-10-02).**
> Avancement : **C1 faite** (`setup.md` étape 11, `.claude/project-context.md` § 9.16), **C2 faite** (étape 12,
> § 9.17), **C3 faite** (étape 13, § 9.18), **C4 faite** (étape 14, § 9.19).
>
> Écarts et précisions de C4 (générateur d'URL) :
> - Aperçu : `GET /api/admin/media/:id/transform?preset=|transform=&format=` (`media:read`), rendu dans la file des traitements,
>   jamais enregistré ni compté, **sans politique** (l'adresse, elle, la respecte) ; en-têtes `X-Transform-Width`, `-Height`,
>   `-Operation` (opération effective : réduction sans agrandissement visible dans l'interface) ; 409 `IN_TRASH`.
> - Adresses : `POST /api/admin/media/:id/links` (1 à 4 dérivés, `expiresIn` pour un média privé), même logique que les liens de
>   l'API (`issueSignedUrl`, politique de l'espace, bibliothèque comprise), erreurs par lien (`code`, `param`, `detail`).
>   `resolveTransformRequest` (service des transformations) est désormais commun à l'aperçu, aux adresses et à l'API (erreurs
>   métier `data.code`, converties en problèmes RFC 9457 par l'API).
> - Options du générateur dans `GET /api/admin/media/:id` (`transforms` : politique, préréglages utilisables, formats, borne).
> - Interface : préréglage ou paramètres structurés (champs partagés avec le dialogue des préréglages : `AdminTransformFields` ;
>   ni `crop` ni `dpr` dans les champs), format, validité du lien pour un média privé ; mise à jour après 400 ms de pause, requête
>   précédente annulée. Extraits : `<img>`, `<picture>` (AVIF, WebP, repli JPEG sinon PNG), `srcset` 1x/2x (`dpr_2`, seulement
>   si l'image dépasse la taille demandée) ; attributs échappés (`&amp;` des signatures) — module pur `shared/utils/snippets.ts`.
> - Pas d'aperçu dans le dialogue d'un préréglage (pas de média de référence) : piste.
>
> Écarts et précisions de C3 (API et point d'intérêt) :
> - `signed-url` : cibles `file | preset | transform | derived` ; `preset` = tout préréglage de l'espace (404 `PRESET_NOT_FOUND`) ;
>   `transform` canonisée par le serveur (ordre libre, `dpr` replié, vide → `full`) ; `format` (`webp` par défaut, formats activés) ;
>   `derived` : l'URL renvoyée est celle du préréglage ou de la transformation demandés (aperçu par défaut). Corps strict ; combinaisons
>   incohérentes (format avec l'original, `preset` et `transform` ensemble…) → 400.
> - Signature délivrée (fonction pure `signaturePlan`) : média privé → à échéance ; public → aucune, sauf transformation libre en
>   `signed` → **permanente** ; **jeton délégué : à échéance, jamais permanente** (« jamais de lien long ») ; `derived` d'un média public
>   en `signed` → à échéance ; politique `presets` → 403 `TRANSFORM_NOT_ALLOWED` pour une transformation (l'URL ne serait jamais servie).
> - Lot `signed-urls` : `{ items: [{ url, query, expiresAt } | { error: { code, detail? } }] }` (même forme que l'unitaire), une échéance
>   pour tout le lot ; codes par lien : `INVALID_REQUEST`, `MEDIA_NOT_FOUND`, `PRESET_NOT_FOUND`, `INVALID_TRANSFORM`,
>   `TRANSFORM_NOT_ALLOWED` ; une forme invalide fait échouer tout le lot (400, `errors[].path` = `items.N.champ`).
> - `urlTemplate` : média privé → signature `derived` alignée sur `urlExpiresAt` ; public → sans signature (en `signed`, les paramètres
>   libres passent par un lien signé).
> - Point d'intérêt : 4 décimales ; même point → aucune nouvelle version ; images seulement (400) ; corbeille → 409 `IN_TRASH` ; conflit →
>   409 `VERSION_CONFLICT` ; dérivés de l'ancienne version supprimés ; **conservé au remplacement du fichier** (comme le titre), **repris à la
>   duplication** ; non journalisé (comme le remplacement).
> - OpenAPI : la grammaire de `/m/` est une section « Transformations d'images » de la description générale (pas d'opération `/m/`) ;
>   codes `INVALID_TRANSFORM`, `TRANSFORM_NOT_ALLOWED`, `PRESET_NOT_FOUND`, `TRANSFORM_QUOTA` au catalogue `API_ERRORS`.
> - Interface : section « Point d'intérêt » de la fiche média (clic, curseurs, aperçus 1:1 et 16:9 calculés comme le serveur par
>   `focalObjectPosition`, testée contre `planTransform`) ; boutons jamais désactivés (le focus resterait sur un bouton inactif).
>
> Écarts et précisions de C2 (politique et préréglages) :
> - Définition d'un préréglage : ni zone `crop` (pixels propres à une image), ni transformation vide (utiliser `full`) ;
>   `original` réservé en plus de `preview` et `full`. 400 `INVALID_TRANSFORM` avec `data.param` (champ en erreur dans l'interface).
> - Routes d'administration : `GET|PATCH /api/admin/transforms?project=` (politique + préréglages + limites ; sans `project` =
>   installation) et `POST /api/admin/presets?project=`, `PATCH|DELETE /api/admin/presets/:id`. Codes `PRESET_NOT_FOUND`,
>   `PRESET_NAME_TAKEN`, `PRESET_LIMIT_REACHED`.
> - Politique : en `SIGNED`, le droit élargi `derived` et un identifiant d'API comptent comme signature ; en `PRESETS`, tout est
>   refusé pour les paramètres libres (signature exacte, `derived`, identifiant d'API) sauf `scope=admin`.
> - L'onglet « Transformations » est visible de tout membre (lecture) ; modification avec `project:settings` (propriétaires).
> - API v1 `GET …/presets` : `{ items: [{ name, transformation, description, level }] }`, globaux masqués exclus ; la politique est
>   dans le contrat `Project` (`transformPolicy`). Étiquette OpenAPI « Transformations ».
> - Journal : `preset.created|updated|deleted`, `project.updated` (`transformPolicy`), `settings.updated` (`libraryPolicy`) ;
>   catégories « Préréglages » et « Réglages ».
> - Pas d'aperçu du rendu dans le dialogue d'un préréglage (prévu avec le générateur d'URL, C4).
>
> Écarts et précisions de C1 (moteur et diffusion) :
> - **Ordre canonique = ordre d'exécution** : `r, flip, crop, w, h, fit, g, q, bg` (et non `crop, r, flip…` comme au § 3.1) : une
>   URL se lit dans l'ordre où elle s'applique (la zone s'entend dans l'image tournée).
> - **Forme canonique indépendante du format** : `q_` et `bg_` explicites sont conservés même égaux au défaut du format (le § 2.1
>   annonçait `q_80/x.jpg` → `full`) ; c'est la condition de CD5 (une signature pour toutes les sources). Le fichier reste partagé
>   (l'opération effective résout la qualité). Seule une transformation vide (`r_0`, `fit_cover` seuls…) devient `full`.
> - **Borne de sortie sans erreur** pour une sortie issue de l'image (`full`, zone, `inside`/`outside`) : réduite dans 4096 × 4096 ;
>   seuls `w`/`h` demandés au-delà de la borne donnent 400.
> - **Opération effective** : identifiant `[r_,flip_,crop_,size_WxH[,fit_cover,g_|,fit_contain,bg_],flatten_,q_]|full.<format>` ;
>   réductions proportionnelles en dimensions exactes ; `g_focal` sans point d'intérêt = `centre` (C3 fournira le point).
> - **sharp** applique toujours le miroir avant la rotation explicite : axes du miroir permutés après un quart de tour (vérifié
>   sur les 16 combinaisons). AVIF : effort 2 (mesuré).
> - **Aperçus existants** repris au démarrage (plugin `variant-keys`, fichier conservé) plutôt que par la migration de C2.
> - Débit par IP : appliqué aux générations libres non signées **et** au droit élargi `derived` ; exemptés : signature exacte ou
>   permanente, `scope=admin`, identifiant d'API. Erreurs `/m/` au format d'erreur Nitro (`data.code`, `data.detail`), pas RFC 9457.
> - Signature permanente : droit signé `…:perm`, sans `exp` ; refusée avec `scope` ou pour l'original ; acceptée seulement pour un
>   média public (privé → 403 `SIGNATURE_INVALID`). Pas encore délivrée par l'API (C3).
> Prolonge la décision **D15** de la phase B (validée) : grammaire d'URL, paramètres, format donné par
> l'extension, ordre d'exécution fixe, forme canonique avec redirection 301, politique par projet
> (`open` borné par défaut), liens signés v2. Référence : `.claude/architecture-phase-b.md` § 10.
> Ce document précise ce que D15 laissait ouvert ; les choix à valider sont récapitulés au § 13
> (CD1 à CD12).

---

## 1. Résumé en 10 points

1. Toute image se transforme **par URL GET** : `/m/<id>/v<n>/<transformation>/<nom>.<format>`.
   Rien ne change pour les URL actuelles (original, `preview`).
2. Le segment de transformation est **soit un préréglage nommé** (`thumb`, `hero`…), **soit une liste de
   paramètres** `clé_valeur` séparés par des virgules (`w_800,h_600,q_75`). Le format de sortie est
   **toujours l'extension** (`jpg`, `png`, `webp`, `avif`).
3. Une URL non canonique (ordre, valeurs par défaut, zéros, `jpeg`, `dpr`) reçoit une **301** vers la
   forme canonique : un résultat = une URL = un fichier.
4. **Jamais d'agrandissement** : une demande plus grande que l'original est réduite en **gardant le
   rapport demandé** (calcul fait par nous, sharp ne le fait pas), servie sans redirection, et partage
   son fichier avec les autres demandes équivalentes.
5. Chaque dérivé est **généré une fois**, conservé (`MediaVariant`, clé immuable), servi avec un cache
   d'un an ; les générations passent par la file bornée de B4.
6. **Politique par espace** : `open` (défaut), `signed` (paramètres libres signés), `presets`
   (préréglages seulement). Projet : réglage du projet ; bibliothèque : réglage de l'installation.
7. **Préréglages** : intégrés (`preview`, `full`), globaux (ADMIN) et par projet (`project:settings`).
8. **Garde-fous** : bornes (4096 px, qualité, formats), 50 dérivés libres par version, débit de
   nouvelles générations par IP, file bornée, canonisation.
9. **API** : `urlTemplate` et `focalPoint` dans le contrat `Media`, liens signés pour une transformation
   ou un préréglage (unitaires et par lot), liste des préréglages, point d'intérêt modifiable.
10. **Administration** : onglet « Transformations » des projets, page « Réglages » de l'installation,
    point d'intérêt et générateur d'URL sur la fiche média.

## 2. Grammaire d'URL

```text
/m/<id>/v<n>/<nom>.<ext>                 original, inchangé (extension indicative)
/m/<id>/v<n>/<préréglage>/<nom>.<format> préréglage : ^[a-z][a-z0-9-]{0,31}$ (jamais de « _ »)
/m/<id>/v<n>/<paramètres>/<nom>.<format> transformation libre : clé_valeur[,clé_valeur…]
```

- `<format>` ∈ `jpg`, `png`, `webp`, `avif` (liste réglable, § 8) ; `jpeg` → 301 vers `jpg`.
  GIF et images animées en sortie : plus tard (première image seulement en entrée, comme l'aperçu).
- `<nom>` reste indicatif (slug du titre) : jamais redirigé, jamais utilisé pour trouver le fichier.
- La chaîne de requête ne sert qu'aux signatures (`exp`, `kid`, `scope`, `sig`) ; tout autre paramètre
  est ignoré.
- Ancienne version → 302 vers la version courante **en gardant le segment de transformation** (existant
  pour `preview`). Média non image → 404.
- Limites d'analyse : segment ≤ 200 caractères, 10 paramètres au plus ; clé inconnue, clé répétée ou
  valeur invalide → 400 `INVALID_TRANSFORM` (le `detail` nomme le paramètre fautif).

### 2.1 Préréglages intégrés (noms réservés)

| Nom | Paramètres | Usage |
| --- | --- | --- |
| `preview` | `w_480,h_480,fit_inside,q_72` | aperçu de l'administration (URL actuelle `preview/<nom>.webp` inchangée) |
| `full` | aucun | image entière réencodée : conversion de format seule, métadonnées (EXIF, GPS) retirées |

`full` est aussi la **forme canonique d'une transformation vide** (ex. `q_80/x.jpg` alors que 80 est la
qualité par défaut du JPEG → 301 vers `full/x.jpg`).

## 3. Paramètres

| Clé | Valeurs | Défaut | Effet |
| --- | --- | --- | --- |
| `crop` | `x-y-l-h` (entiers, `l` et `h` ≥ 1) | — | zone extraite, en pixels de l'image **orientée et tournée** |
| `r` | `90`, `180`, `270` | 0 | rotation horaire |
| `flip` | `h`, `v`, `hv` | — | miroir horizontal, vertical, les deux |
| `w`, `h` | 1 à 4096 (borne réglable) | — | dimensions cibles |
| `dpr` | 1 à 3 (pas de 0,5) | 1 | multiplie `w` et `h` (dans la borne) ; **disparaît de la forme canonique** |
| `fit` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` | n'a de sens qu'avec `w` **et** `h` ; avec une seule dimension : redimensionnement proportionnel |
| `g` | `center`, `north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest`, `attention`, `entropy`, `focal` | `focal` | ancrage du recadrage (`fit_cover` seulement) ; `focal` = point d'intérêt du média, **centre s'il n'en a pas** |
| `q` | 1 à 100 | selon le format | qualité ; JPEG 80 (mozjpeg), WebP 80, AVIF 50, PNG sans perte (`q_` active la palette) |
| `bg` | `rrggbb` | transparent, blanc pour JPEG | fond de `fit_contain` et des zones transparentes converties en JPEG |

**Ordre d'exécution fixe** (indépendant de l'ordre dans l'URL) : orientation EXIF → rotation → miroir →
zone → redimensionnement → fond → encodage (métadonnées retirées, conversion sRVB). Vérifié avec sharp
0.35 (`autoOrient()` puis `rotate(n)`, `flip`/`flop`, `extract`, `resize`, `flatten`).

### 3.1 Forme canonique (301)

- Clés dans l'ordre : `crop`, `r`, `flip`, `w`, `h`, `fit`, `g`, `q`, `bg`.
- Valeurs par défaut et paramètres sans effet retirés : `r_0`, `fit_cover`, `g_focal`, `fit` sans les deux
  dimensions, `g` hors `fit_cover`, `q` égal au défaut du format, `bg` égal au défaut du format.
- Nombres sans zéro initial ; couleur en minuscules ; `dpr` appliqué à `w`/`h` puis retiré (les deux
  dimensions réduites du même facteur si la borne est atteinte) ; `jpeg` → `jpg`.
- Transformation vide → `full`.
- La canonisation est **purement syntaxique** (elle ne dépend pas du média) : fonction pure, testée.
- 301 avec `Cache-Control: public, max-age=86400` ; la chaîne de requête (signature) est conservée.

### 3.2 Bornage selon le média (sans redirection)

Une fois le média connu, la demande canonique est traduite en **opération effective** :

- zone hors de l'image (après orientation et rotation) → 400 `INVALID_TRANSFORM` ;
- dimensions demandées plus grandes que la source : réduites du même facteur **en gardant le rapport
  demandé** (ex. `w_2000,h_1000` sur 1200 × 800 → 1200 × 600 recadré) ; sharp seul rendrait 1200 × 800
  sans recadrage ;
- dimensions de sortie ≤ borne (4096 × 4096 par défaut).

Le fichier est identifié par l'**opération effective** : `w_1600`, `w_2000` et `w_5000` sur une image de
1200 px produisent le même fichier (un seul dérivé, aucune consommation du quota par ces variations).

## 4. Diffusion

Chemin chaud inchangé dans son principe : analyse et canonisation (pures) → média (cache 60 s) →
politique de l'espace (cache 60 s) → accès → dérivé (cache 10 min, puis `MediaVariant`) → génération si
absent.

| Fichier | Cache-Control | ETag |
| --- | --- | --- |
| Original, transformation libre, `preview`, `full` (public) | `public, max-age=31536000, immutable` | empreinte + opération |
| Préréglage global ou de projet (public) | `public, max-age=604800` (réglable) + revalidation | empreinte + définition du préréglage |
| Privé signé | `private, max-age=<reste>` (existant) | idem |
| Privé par identifiant (`Bearer`) | `private, no-cache` (existant) | idem |

- Un préréglage **modifiable** ne peut pas être `immutable` (même URL, nouveau contenu) : 7 jours puis
  revalidation, 304 tant que la définition n'a pas changé (CD7).
- `Content-Disposition` : `<nom>.<format>` ; `Content-Type` du format produit ; `Range`, HEAD, 304,
  en-têtes de sécurité et CORS identiques à l'existant.
- Média non image : 404 pour toute transformation (les vidéos auront leurs propres dérivés en phase D).

### 4.1 Génération

- `server/lib/media/transform.ts` : construit le pipeline sharp à partir de l'opération effective
  (première image, `limitInputPixels` 100 Mpx, `autoOrient`, puis l'ordre du § 3) ; gravité `focal` =
  zone calculée par nous autour du point d'intérêt, bornée à l'image, puis `extract` + `resize`.
- Exécution dans la file bornée de B4 (503 `SERVER_BUSY` + `Retry-After`), dédoublonnage par processus
  (Map de promesses) et entre instances (unicité `MediaVariant (mediaId, transformation)`).
- `MediaVariant.transformation` = `v<n>/<opération effective>.<format>` (≤ 120 caractères, dans la limite
  des 191 de MySQL) ; clé de stockage `variants/<id>/v<n>-<empreinte>.<format>` (existant).
- AVIF : effort réduit (coût de calcul), réglé d'après des mesures en C1.
- L'aperçu existant (`v<n>/preview`) devient le préréglage intégré : les anciennes lignes sont reprises
  par une requête SQL portable dans la migration de C2 (sinon régénérées une fois).

## 5. Accès et politique

### 5.1 Politique d'un espace

| Mode | Paramètres libres | Préréglages | Usage |
| --- | --- | --- | --- |
| `open` (défaut) | oui, dans les bornes et quotas | oui | sites publics construisant leur `srcset` côté client |
| `signed` | seulement signés | oui | installations exposées à fort trafic |
| `presets` | non | oui | contrôle maximal |

- Projet : `Project.transformPolicy`. Bibliothèque : réglage de l'installation (§ 9.2).
- Refus : 403 `TRANSFORM_NOT_ALLOWED`. Préréglage inconnu dans l'espace : 404.
- Les liens signés `scope=admin` (aperçus de l'administration) ne sont pas soumis à la politique, mais
  restent soumis aux bornes.

### 5.2 Accès selon la visibilité

| Demande | Média public | Média privé |
| --- | --- | --- |
| Sans signature | selon la politique | 403 `MEDIA_FORBIDDEN` (existant) |
| Signature exacte `t:<transformation>` ou `preset:<nom>` | toujours (sauf `presets` pour `t:`) | idem, avec échéance |
| Signature `derived` (tout dérivé de la version) | selon la politique (`signed` : accepté) | idem |
| `Authorization: Bearer` (`media:read`) | — | selon la politique (`signed` : accepté) |

### 5.3 Signatures (format v2 inchangé)

- Droit signé : `t:<transformation canonique>` ou `preset:<nom>` — **sans le format** : une seule
  signature couvre les sources AVIF, WebP et JPEG d'un `<picture>` (CD5).
- **Signature permanente** (sans `exp`) : acceptée seulement pour un **dérivé d'un média public**
  (mode `signed` : URL permanente et cachable) ; un média privé exige toujours une échéance. Un média
  public devenu privé invalide de fait ces signatures (CD6).
- Elles sont délivrées par l'API (§ 7) ; une signature calculée **localement** par le SDK, sans appel
  (clé de signature dédiée par projet), est une évolution possible (§ 12).

## 6. Garde-fous

| Garde-fou | Valeur par défaut | Variable | Effet au-delà |
| --- | --- | --- | --- |
| Dimensions de sortie | 4096 × 4096 | `NUXT_MEDIA_TRANSFORM_MAX_DIMENSION` | 400 `INVALID_TRANSFORM` |
| Pixels décodés | 100 Mpx (existant) | — | dérivé impossible (422 à l'envoi) |
| Formats de sortie | `jpg,png,webp,avif` | `NUXT_MEDIA_TRANSFORM_FORMATS` | 400 `INVALID_TRANSFORM` |
| Dérivés libres par version de média | 50 | `NUXT_MEDIA_TRANSFORM_MAX_VARIANTS` | 429 `TRANSFORM_QUOTA` |
| Nouvelles générations libres non signées, par IP et par minute | 60 | `NUXT_MEDIA_TRANSFORM_RATE_LIMIT` (0 = désactivé) | 429 `TRANSFORM_QUOTA` + `Retry-After` |
| Traitements simultanés | cœurs, file de 100 (existant) | `NUXT_MEDIA_PROCESSING_*` | 503 `SERVER_BUSY` |
| Cache des préréglages | 7 jours | `NUXT_MEDIA_TRANSFORM_PRESET_MAX_AGE` | — |

- Les dérivés **déjà générés** et les **préréglages** restent toujours servis (le quota et le débit ne
  portent que sur la création de nouveaux dérivés libres).
- Le quota compte les lignes `MediaVariant` de la version (une requête, seulement au moment de générer).
- **Derrière un CDN**, toutes les requêtes viennent de quelques adresses : relever ou désactiver le débit
  par IP (tant que `X-Forwarded-For` de confiance n'existe pas, piste B3). Documenté dans `setup.md`.

## 7. API v1

| Méthode et chemin | Changement |
| --- | --- |
| Contrat `Media` | + `urlTemplate` : `…/m/<id>/v3/{transform}/affiche-ete.{format}` (+ signature `derived` d'environ 1 h pour un média privé ; `null` hors images) ; + `focalPoint: { x, y } \| null` (0 à 1) |
| Contrat `Project` | + `transformPolicy: open \| signed \| presets` |
| `PATCH …/media/{mediaId}` | + `focalPoint` (`null` efface) — **incrémente la version** (CD8) |
| `POST …/media/{mediaId}/signed-url` | `target` + `transform` (canonisée, 400 sinon) et `format` ; `preset` accepte tout préréglage de l'espace ; média public : URL permanente, signée si la politique l'exige |
| `POST /projects/{projectId}/signed-urls` (nouveau) | lot de 100 au plus : `{ items: [{ mediaId, target, preset?, transform?, format? }], expiresIn? }` → `{ items: [{ url, expiresAt } \| { error }] }` (une page entière de `srcset` en un appel) |
| `GET /projects/{projectId}/presets` (nouveau) | préréglages utilisables dans le projet (`builtin`, `global`, `project`, le projet masquant un global homonyme) ; toute clé, y compris publique ; ETag |

- Codes ajoutés au catalogue : `INVALID_TRANSFORM` (400), `TRANSFORM_NOT_ALLOWED` (403),
  `TRANSFORM_QUOTA` (429), `PRESET_NOT_FOUND` (404).
- OpenAPI : schémas et routes ci-dessus ; une section de description documente la grammaire de `/m/`
  (piste de l'étape 10).
- La gestion des préréglages et de la politique reste **réservée à l'administration** (aucun identifiant
  d'API ne modifie les réglages d'un projet).

## 8. Configuration

Nouvelles variables (`runtimeConfig.media.transform`, `.env.example`, `setup.md`) :
`NUXT_MEDIA_TRANSFORM_MAX_DIMENSION` (4096), `_FORMATS` (`jpg,png,webp,avif`), `_MAX_VARIANTS` (50),
`_RATE_LIMIT` (60), `_PRESET_MAX_AGE` (604800). Aucune n'est obligatoire.

## 9. Préréglages et réglages

### 9.1 Préréglages

- Trois niveaux : **intégrés** (code, non modifiables), **globaux** (toute l'installation, bibliothèque
  comprise ; ADMIN), **de projet** (`project:settings`). Un préréglage de projet peut masquer un global
  du même nom ; `preview` et `full` sont réservés.
- Définition = transformation canonique **sans format** (validée par le même analyseur) + description
  facultative. 100 préréglages au plus par niveau. Noms uniques par niveau (contrôlés par l'application,
  comme les dossiers). Créations, modifications et suppressions journalisées.
- Modifier un préréglage change le contenu de ses URL : nouveau fichier généré à la demande, caches
  rafraîchis sous 7 jours au plus (§ 4). Supprimer un préréglage : ses URL renvoient 404.

### 9.2 Réglages de l'installation

- Nouvelle page **« Réglages »** (`/admin/settings`), nouvelle permission de plateforme
  **`settings:manage`** (ADMIN). Première section « Transformations d'images » : politique de la
  bibliothèque, préréglages globaux, rappel en lecture seule des bornes (variables d'environnement).
- Stockage : modèle clé-valeur `Setting` (réutilisable plus tard : courriel, etc.).
- Caches : état des réglages globaux et préréglages globaux en L1 60 s ; `ProjectState` gagne la politique
  et les préréglages du projet (même cache, même invalidation).

## 10. Interface d'administration

- **Projet → nouvel onglet « Transformations »** : politique (`UiRadioCards`, explication de chaque mode),
  liste des préréglages (intégrés, globaux, du projet), création / modification / suppression en
  dialogue (champs structurés : largeur, hauteur, ajustement, ancrage, qualité, fond, rotation, miroir ;
  la forme canonique est affichée). Lecture avec `project:read`, modification avec `project:settings`.
- **Réglages** (ADMIN) : § 9.2.
- **Fiche média** :
  - **Point d'intérêt** : clic sur l'image (pointeur unique, sans glisser : WCAG 2.5.7) **et** deux
    curseurs X / Y (%) utilisables au clavier ; effacer ; aperçu du recadrage sur deux formats. Changer
    le point crée une nouvelle version (expliqué dans l'interface).
  - **Générateur d'URL** : préréglage ou paramètres, format, aperçu, URL à copier, exemples `srcset` et
    `<picture>`. L'aperçu est rendu **à la volée par une route d'administration, sans être conservé ni
    compté dans le quota** (`GET /api/admin/media/:id/transform`, session, `media:read`).
- Tout en fr/en, WCAG 2.2 AA clair/sombre, avec les composants existants.

## 11. Modèle de données

```prisma
enum TransformPolicy { OPEN SIGNED PRESETS }

model Project {
  // …
  /// Politique des transformations libres (architecture phase C § 5)
  transformPolicy TransformPolicy @default(OPEN)
  presets         TransformPreset[]
}

/// Préréglage de transformation : global (projectId null) ou propre à un projet
model TransformPreset {
  id             String   @id @default(cuid())
  projectId      String?                                  // Cascade
  name           String                                   // ^[a-z][a-z0-9-]{0,31}$, unique par niveau (application)
  /// Transformation canonique, sans format (ex. « w_800,h_450,q_70 »)
  transformation String
  description    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([projectId])
}

/// Réglages de l'installation (clé-valeur), ex. « transforms.libraryPolicy »
model Setting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}

model Media {
  // …
  /// Point d'intérêt (0 à 1, origine en haut à gauche de l'image orientée) : gravité « focal »
  focalX Float?
  focalY Float?
}
```

Migrations pour les 3 fournisseurs : `c2_transforms` (politique, préréglages, réglages, reprise des
aperçus) puis `c3_focal_point`. Portabilité respectée (pas de `@db.*`, chaînes ≤ 191).

## 12. Découpage, vérification et hors périmètre

| Sous-étape | Contenu | Migration |
| --- | --- | --- |
| **C1 — Moteur et diffusion** | analyseur et canonisation (purs, Vitest), bornage, pipeline sharp, `/m/` (paramètres libres, `preview`/`full`, format par l'extension, 301, 302 de version), stockage des dérivés, quota et débit, signatures `t:` et permanentes, codes d'erreur ; politique `open` partout | aucune |
| **C2 — Politique et préréglages** | politique par projet et pour la bibliothèque, préréglages (3 niveaux), page « Réglages », onglet « Transformations », `GET …/presets`, `Project.transformPolicy`, journal | `c2_transforms` |
| **C3 — API et point d'intérêt** | `urlTemplate`, `focalPoint`, `signed-url` étendu, lot `signed-urls`, OpenAPI et documentation de `/m/`, point d'intérêt dans la fiche média | `c3_focal_point` |
| **C4 — Générateur d'URL** | générateur sur la fiche média (aperçu non conservé), extraits `srcset` / `<picture>` | aucune |

Chaque sous-étape est validée puis commitée séparément (journal de `setup.md` : étapes 11 à 14). Mêmes
contrôles qu'en phase B : `typecheck`, Vitest, `i18n:check`, `a11y:contrast`, `db:migration --check`,
build de production, scénarios d'API et de diffusion (dont les refus : politique, quota, bornes, zone
hors image, signature d'un autre format, média privé), vérification visuelle des sorties (dimensions,
orientation EXIF, transparence vers JPEG), audit axe fr/en × clair/sombre, documentation.

**Hors périmètre de la phase C** (évolutions possibles, compatibles) : sortie GIF et animations,
négociation automatique du format (`Vary: Accept`), agrandissement sur demande, flou, netteté, filtres,
incrustations et filigranes, recadrage par détection de visages, signature locale par le SDK, purge des
dérivés jamais redemandés, purge CDN, quotas par projet, « appliquer et remplacer » (une transformation
devient une nouvelle version), `@surge-media/client` et composants (étape suivante).

## 13. Décisions à valider

| # | Proposition | Alternative écartée |
| --- | --- | --- |
| CD1 | Découpage C1 → C4, chaque sous-étape validée et commitée séparément | une seule livraison |
| CD2 | Préréglages intégrés `preview` (inchangé) et `full` (conversion seule, forme canonique d'une transformation vide) ; noms réservés | paramètre `f_` (contraire à « format par l'extension ») |
| CD3 | Jamais d'agrandissement : dimensions réduites en gardant le rapport demandé, sans redirection, fichier partagé entre demandes équivalentes | 301 vers les dimensions réelles (aller-retour en plus pour chaque `srcset`) |
| CD4 | `dpr` replié dans `w`/`h` par la forme canonique (301) | `dpr` conservé dans l'URL (deux URL pour un même fichier) |
| CD5 | Une signature couvre la transformation, pas le format | une signature par format |
| CD6 | Mode `signed` : signature permanente pour les dérivés d'un média public, délivrée par l'API (unitaire + lot de 100) | signature locale par le SDK avec une clé dédiée (plus tard) |
| CD7 | Préréglages modifiables ; leurs URL en cache 7 jours puis revalidées ; paramètres libres immuables 1 an | préréglages figés (immuables, renommer pour changer) |
| CD8 | Changer le point d'intérêt **incrémente la version** (caches toujours cohérents ; l'URL de l'original change aussi, l'ancienne redirige en 302 ; dérivés régénérés à la demande) ; gravité par défaut = point d'intérêt, sinon centre | gravité `focal` explicite seulement, caches potentiellement périmés après un changement |
| CD9 | Garde-fous : 4096 px, `jpg/png/webp/avif`, 50 dérivés libres par version, 60 générations libres non signées par IP et par minute (0 = désactivé), préréglages exemptés | quotas par projet (plus tard) |
| CD10 | Page « Réglages » de l'installation (permission `settings:manage`, ADMIN) avec la politique de la bibliothèque et les préréglages globaux ; modèle `Setting` | variables d'environnement seulement (pas de préréglages globaux dans l'interface) |
| CD11 | Aperçu du générateur rendu à la volée par l'administration, non conservé, hors quota | URL `/m/` signée « admin » (consomme le quota du média) |
| CD12 | 100 préréglages par niveau ; un préréglage de projet peut masquer un global homonyme ; opérations journalisées | homonymie interdite entre niveaux |
