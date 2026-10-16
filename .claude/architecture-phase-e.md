# Phase E — Bibliothèques front : `@surge-media/client` et `@surge-media/vue`

> **Statut : ÉTUDE VALIDÉE (2026-10-15)** — inventaire des composants et des fonctionnalités médias réalisables côté
> front, d'après ce que l'API du core permet aujourd'hui (vérifié dans le code). Choix de l'utilisateur du 2026-10-15 :
> découpage **client + vue** (ED1), **thème facultatif** (ED10), **les quatre familles dans la 0.1** livrées par étapes
> E1 à E5 (ED14), **Nuxt dans un paquet séparé plus tard** (ED15). Les autres décisions sont des recommandations
> acceptées avec le plan ; chaque étape (E1…E5) sera **détaillée puis validée avant d'être codée**, comme les phases B à D.
> **E1 VALIDÉE tel quel puis FAITE le 2026-10-15** (§ 11, décisions ED18 à ED28 ; `setup.md` § 17 et étape 26 ;
> état, écarts et vérifications : section « E1 — état de l'implémentation » en fin de document). Suite : **E2 (envoi)**,
> à détailler et faire valider avant le code.
>
> Sources : `apps/core/shared/schemas/api.ts` (contrats v1), `apps/core/shared/utils/{api,permissions,transforms,
> snippets,video,folders}.ts`, `server/api/v1/**`, `server/lib/access/principal.ts`, `.claude/project-context.md`
> § 9.6 à § 9.23 et § 10, `.claude/architecture-phase-b.md` § 7 (consommation par les frontends, prévue dès la phase B).

## 1. Résumé en 10 points

1. Deux paquets dans `packages/` : **`@surge-media/client`** (TypeScript sans framework, navigateur / Node / edge) et
   **`@surge-media/vue`** (composants et composables Vue 3.5+). React et Svelte réutiliseront le client.
2. Trois façons d'utiliser les composants : **sans identifiant** (le back fournit des objets `Media`), **clé publique**
   (médias publics, galeries) ou **jeton délégué** émis par le back du client (sélection, envoi, édition) — § 2.
3. **Affichage** : `SmImage`, `SmPicture`, `SmVideo`, `SmMedia`, `SmThumbnail`, `SmProcessingStatus`, `SmGallery`,
   `SmLightbox`, `SmVideoChapters`, `SmTranscript` — images responsives (srcset, AVIF/WebP, point d'intérêt,
   préréglages) et vidéos (sources AV1/H.264, affiche, sous-titres, état du traitement).
4. **Envoi** : `SmUploader` (file, progression, annulation, contraintes du jeton), `SmPosterCapture` ; aide serveur
   `@surge-media/client/server` pour émettre les jetons délégués.
5. **Parcours et sélection** : `SmMediaBrowser`, `SmMediaPicker`, `SmMediaField`, `SmFolderBreadcrumb`, `SmFolderActions`.
6. **Édition** : `SmMediaEditor`, `SmFocalPointPicker`, `SmImageCropper` (recadrage non destructif), `SmPosterEditor`,
   `SmTextTracks`.
7. Exigences du projet appliquées aux paquets : **fr par défaut + en**, aucun texte en dur ; **WCAG 2.2 AA** en clair et
   sombre ; **SSR** sans accès à `window` à l'import.
8. Style : composants **sans dépendance CSS** + thème **facultatif** `style.css` (jetons `--sm-*`, `@layer`), sans Tailwind
   imposé.
9. Quatre **petites évolutions du core** rendent les composants fiables : formats activés dans l'API (indispensable dès
   E1), limites d'envoi dans `/me`, écritures d'un jeton délégué limitées à son sujet, restauration par l'API — § 6.
10. Livraison de la 0.1 en **cinq étapes** (E1 affichage, E2 envoi, E3 parcours, E4 édition, E5 publication), chacune
    détaillée et validée avant le code — § 8.

## 2. Ce que le front peut faire, selon l'identifiant

Vérifié dans le code : `credentialScopes` (`shared/utils/permissions.ts` : clé publique = `TOKEN_BASE_SCOPES` =
`project:read` + `media:read`), `browserGuard` (`server/lib/access/principal.ts`), routes `server/api/v1/**`.

| Fonctionnalité | Sans identifiant (objet `Media` fourni par le back) | Clé publique `sm_pk_` | Jeton délégué `sm_dt_` (via `getToken()`) |
| --- | --- | --- | --- |
| Afficher une image / vidéo publique | oui | oui | oui |
| Afficher un média privé | oui, jusqu'à `urlExpiresAt` | non (médias publics seulement) | oui (`media:read`) |
| Lister, chercher, filtrer, trier | non | publics seulement, si le projet active la « liste publique » (sinon 403 `LISTING_DISABLED`) | oui |
| Réhydrater par `ids` (≤ 100, ordre conservé) | non | oui (publics) | oui |
| Dossiers | non | non (403 `CREDENTIAL_NOT_ALLOWED`) | lecture `media:read`, écriture `media:write` |
| Préréglages et politique de transformation du projet | non | oui | oui |
| Liens signés (`derived` = une signature pour tout un srcset) | non | non | oui, ≤ 1 h (`DELEGATED_SIGNED_URL_MAX_TTL`) |
| Envoi | non | non | `media:upload` + contraintes (`maxFiles`, `maxSize`, `types`, visibilité et dossier imposés) |
| Modifier, point d'intérêt, affiche, pistes de texte | non | non | `media:write` |
| Mettre à la corbeille | non | non | `media:delete` |
| Dupliquer | non | non | non : clé secrète ou jeton personnel seulement (reste côté back) |

Règles communes : jamais de clé secrète ni de jeton personnel dans le navigateur (403 `SECRET_IN_BROWSER`) ; clé publique
et jeton délégué vérifiés contre les origines du projet (403 `ORIGIN_NOT_ALLOWED`) ; jeton délégué valable 1 à 60 min
(15 par défaut), lié à une origine exacte s'il en porte une ; débits par défaut 300 req/min par (clé publique, IP) et par
(émetteur d'un jeton délégué, IP), 60 envois/min par identifiant (`runtimeConfig.api.rateLimit`) ; `/m/` répond avec
`Access-Control-Allow-Origin: *` (lecture en `canvas` et `<track>` possibles en mode CORS).

## 3. Couche `@surge-media/client`

### 3.1 Client HTTP
- `createSurgeClient({ baseUrl, projectId, publishableKey | getToken, fetch?, locale? })`.
- **Jeton délégué** : `getToken()` appelé à la demande, résultat mis en cache ; la charge (`delegatedTokenClaimsSchema`,
  lisible sans la signature) donne `exp`, les portées et les contraintes d'envoi ; renouvellement ~60 s avant l'échéance ;
  un seul rejeu sur 401 `TOKEN_EXPIRED` ; appels simultanés partageant le même renouvellement.
- **Cache ETag** : `If-None-Match` sur les lectures (listes, détail, préréglages, dossiers) ; 304 → réponse en cache.
- **Erreurs** : `SurgeApiError { status, code, detail, requestId, retryAfter, errors }` lue depuis `application/problem+json` ;
  messages traduits (fr/en) pour tous les codes du catalogue `API_ERRORS` ; `Retry-After` respecté (429, 503 `SERVER_BUSY`,
  408 `UPLOAD_TIMEOUT`).
- **Ressources** : `me`, `project`, `presets`, `media.list` (+ itérateur par curseur), `media.get`, `media.getMany(ids)`,
  `media.upload(file, champs, { onProgress, signal })` en **XHR** (seule progression d'envoi fiable dans les navigateurs),
  `media.update`, `media.replaceFile`, `media.remove`, `signedUrl`, `signedUrls` (lot de 100), `folders.*`, `tracks.*`, `poster.*`.

### 3.2 Constructeurs d'URL (fonctions pures, sans réseau)
- `buildTransform({ w, h, fit, g, crop, r, flip, q, dpr, bg })` → segment en **forme canonique** (ordre d'exécution
  `r, flip, crop, w, h, fit, g, q, bg`, défauts retirés, `dpr` appliqué aux dimensions puis retiré) : une URL non canonique
  coûte une redirection 301 et une entrée de cache de plus.
- `mediaUrl(media, { preset | transform, format })` à partir de `urlTemplate` (`{transform}`, `{format}`), signature
  `derived` conservée pour un média privé.
- `srcset` en **largeurs** (`w`, bornées à la largeur de la source : le serveur n'agrandit jamais) et en **densités**
  (1x, 2x, 3x, règle de marge du générateur C4) ; `pictureSources` (AVIF → WebP → repli JPEG, **formats activés seulement**).
- `focalObjectPosition` (recadrage CSS sur le point d'intérêt), `videoSources`, `posterUrl` (taille choisie par
  `urlTemplate` de l'affiche), `trackAttributes`, `socialImageUrl` (1200 × 630 pour `og:image`).
- Reprend la logique pure de `apps/core/shared/utils/{transforms,snippets,video,folders}.ts` (ED6).

### 3.3 Politique de transformation (ED7)
| Politique du projet | Paramètres libres | Comportement des composants |
| --- | --- | --- |
| `open` | acceptés dans les bornes du serveur | srcset construit librement depuis `urlTemplate` |
| `signed` | seulement signés | jeton délégué : une signature `derived` pour tout le srcset ; clé publique ou sans identifiant : préréglages, ou signature fournie par le back (`query`) |
| `presets` | refusés | préréglages seulement ; srcset construit à partir de plusieurs préréglages dont la largeur est lue dans leur `transformation` |

Média privé : `urlTemplate` porte déjà une signature `derived` jusqu'à `urlExpiresAt` ; le client relit le média
(`ids`, ETag) avant l'échéance.

### 3.4 Logique sans interface (réutilisée par React et Svelte)
File d'envoi (concurrence 2–3, annulation, nouvel essai, pré-contrôle type / taille / nombre), modèle de sélection
(simple / multiple, `max`, réhydratation par `ids`), navigation dans les dossiers (liste à plat → arbre, fil d'Ariane),
liste paginée par curseur, suivi du traitement vidéo (relecture avec ETag, arrêt sur `ready` / `failed`, pause onglet
masqué), rafraîchissement des URL signées.

### 3.5 Entrée serveur `@surge-media/client/server`
Jamais incluse dans le bundle navigateur (entrée de paquet distincte). `createDelegatedToken({ secretKey, projectId,
scopes, subject, origin, upload, expiresIn })` pour la route du back qui alimente `getToken()` ; recettes (Node/Express,
Nitro/Nuxt, Next, Laravel en HTTP brut) dans la documentation.

## 4. Catalogue des composants `@surge-media/vue` (préfixe `Sm`)

**Socle** : plugin `app.use(SurgeMedia, { client | options, locale, messages, defaults })` (provide/inject ; prop
`client` possible sur chaque composant) ; composables `useSurgeClient`, `useMedia(id)`, `useMediaList(query)`,
`useMediaUrl`, `useUploadQueue`, `useMediaSelection`, `useFolders`, `useProcessing(media)`, `usePresets`.

### 4.1 Affichage (aucun identifiant requis si l'objet `Media` est fourni)
| Composant | Fonctionnalités |
| --- | --- |
| `SmImage` | `srcset` + `sizes`, `width` / `height` (pas de décalage au chargement), `aspect` + `fit_cover` centré sur le **point d'intérêt** (`g_focal`) ou recadrage CSS `object-position`, `preset`, `format`, `loading` / `fetchpriority` / `decoding`, `alt` = prop > `altText` (avertissement en développement sinon), repli en cas d'erreur |
| `SmPicture` | `<picture>` AVIF / WebP + repli, **direction artistique** (sources par media query avec des cadrages différents) |
| `SmVideo` | `<source>` dans l'ordre de `sources` (AV1, H.264, original), affiche dimensionnée, `<track>` + `crossorigin`, `preload` paresseux, pas de lecture automatique ; mode « vidéo d'arrière-plan » muet en boucle **avec bouton pause** (WCAG 2.2.2) ; états du traitement (attente, progression, échec, format converti → « Télécharger l'original ») ; 503 `PROCESSING_PENDING` → nouvel essai après `Retry-After` ; prêt pour HLS (D4) |
| `SmMedia` | aiguille vers `SmImage` / `SmVideo` selon `kind` (extensible à l'audio et aux documents) |
| `SmThumbnail` | vignette carrée, icône du genre, durée (texte `sr-only`), pastille d'état du traitement |
| `SmProcessingStatus` | badge + `<progress>` + annonces `role="status"` aux seules transitions |
| `SmGallery` + `SmLightbox` | grille (médias fournis ou requête par clé publique), visionneuse en `<dialog>` : précédent / suivant, « 3 sur 12 », Échap, focus rendu à la vignette |
| `SmVideoChapters`, `SmTranscript` | navigation par chapitres (piste `chapters`) et transcription lisible (piste `captions`) |

### 4.2 Envoi (jeton délégué `media:upload`)
| Composant | Fonctionnalités |
| --- | --- |
| `SmUploader` | champ fichier natif (toujours présent) + zone de dépôt (amélioration), collage, `capture` sur mobile, multiple, file avec `<progress>` par fichier, annuler / réessayer, pré-contrôle d'après le jeton (`types`, `maxSize`, `maxFiles`), champs titre + **texte alternatif proposé**, visibilité / dossier s'ils ne sont pas imposés, événements `uploaded` / `error` |
| `SmPosterCapture` | capture d'une image de la vidéo locale pendant l'envoi (port de `apps/core/app/utils/video-frame.ts`), puis `PUT …/poster` |

### 4.3 Parcours et sélection (clé publique ou jeton délégué)
| Composant | Fonctionnalités |
| --- | --- |
| `SmMediaBrowser` | recherche, filtres genre / visibilité, tri, pagination par curseur (« Charger plus »), grille ou liste, dossiers (fil d'Ariane + sous-dossiers, jeton seulement), états vides, annonce du nombre de résultats |
| `SmMediaPicker` | dialogue ou en ligne, simple / multiple, `max`, `accept` (genres), `v-model` d'**identifiants stables** réhydratés par `ids`, sélection au clavier (`listbox` `aria-multiselectable`), onglet d'envoi si `media:upload` |
| `SmMediaField` | champ de formulaire : vignettes choisies, Choisir / Retirer, réordonner par boutons (pas de glisser seul, WCAG 2.5.7), `name` → identifiant(s) pour les formulaires natifs |
| `SmFolderBreadcrumb`, `SmFolderActions` | navigation ; création, renommage, déplacement, suppression (`media:write`) |

### 4.4 Édition (jeton délégué `media:write` / `media:delete`)
| Composant | Fonctionnalités |
| --- | --- |
| `SmMediaEditor` | titre, texte alternatif, visibilité, dossier ; remplacement du fichier (409 `VERSION_CONFLICT` géré) ; corbeille avec confirmation |
| `SmFocalPointPicker` | clic + deux curseurs, aperçus 1:1 et 16:9 (port d'`AdminFocalPointEditor`) ; prévient que la version change |
| `SmImageCropper` | **recadrage non destructif** : produit une chaîne de transformation (`crop`, `r`, `flip`) que l'application stocke avec l'identifiant du média ; zone au clic + champs (port d'`AdminCropSelector`) |
| `SmPosterEditor` | capture d'une image de la vidéo ou envoi d'une image ; retrait |
| `SmTextTracks` | envoi VTT / SRT, langue, libellé, type, piste par défaut, remplacement, suppression |

## 5. Exigences transverses

- **i18n** : catalogues typés `fr` (référence, défaut) et `en` dans chaque paquet, `locale` réactive, `messages` pour
  surcharger, `Intl` pour les tailles, durées et dates ; aucun texte en dur (`aria-label` compris) ; parité garantie
  par le typage (`en` doit satisfaire le type de `fr`).
- **Accessibilité WCAG 2.2 AA** : éléments natifs d'abord, motifs ARIA (dialog, listbox, status), gestion du focus,
  alternatives au glisser (2.5.7), cibles ≥ 24 px (2.5.8), `prefers-reduced-motion`, pas de lecture automatique ;
  audit axe en fr / en × clair / sombre dans le bac à sable.
- **Thème facultatif** `@surge-media/vue/style.css` : jetons `--sm-*`, clair / sombre (`prefers-color-scheme` + classe
  `.dark` ou `[data-theme]`), `@layer surge-media` (les styles du site client l'emportent toujours), contrastes AA
  vérifiés par script ; classes `sm-*` stables documentées ; aucun Tailwind imposé.
- **SSR** : rendu complet côté serveur pour l'affichage (srcset déterministe, `useId` de Vue 3.5), aucun accès à
  `window` à l'import ; interactions activées au montage.
- **Distribution** : ESM seul, `sideEffects` limité au CSS, imports à la carte ; pair `vue >= 3.5`.
- **Contrats** : types publics écrits à la main dans le client (documentés, stables) + test de contrat Vitest
  (`expectTypeOf`) contre `apps/core/shared/schemas/api.ts` ; constructeur de transformations recoupé avec
  `parseTransformation` du core sur une table de cas.
- **Construction** : client en tsdown (déjà utilisé par la CLI du core) ; vue en Vite mode bibliothèque + `vue-tsc`
  pour les `.d.ts`.
- **Tests** : Vitest + `@vue/test-utils` (happy-dom) ; bac à sable `apps/playground` (Vite + Vue) branché sur le core
  local (port 3000, projet de test, clé publique et petite route d'émission de jetons délégués) pour axe et les essais réels.

## 6. Évolutions du core utiles (petites, validées avec l'étape qui en a besoin)

| N° | Évolution | Étape | Raison |
| --- | --- | --- | --- |
| 1 | **Formats activés et dimension maximale dans l'API v1** (par exemple `Project.transformFormats`, `maxTransformDimension`) | E1, **indispensable** | un `<source type="image/avif">` vers un format désactivé répond 400 : le navigateur ne retombe pas sur la source suivante, l'image casse |
| 2 | **Limites d'envoi dans `/me`** (taille maximale par genre, types acceptés, envois restants d'un jeton délégué — piste B4) | E2 | pré-contrôle exact avant d'envoyer des centaines de Mio |
| 3 | **Écritures d'un jeton délégué limitées aux médias de son `subject`** (piste B4) | E4 | aujourd'hui un jeton `media:write` modifie tout média du projet : risque si l'édition est confiée à des utilisateurs finaux |
| 4 | **Restauration depuis la corbeille par l'API** (piste B4) | E4 | « Annuler » après une suppression |
| 5 | Plus tard : espace réservé léger (couleur dominante ou ThumbHash calculé à l'envoi), nombre de médias par dossier dans l'API | — | confort d'affichage |

## 7. Décisions

| N° | Décision | Alternative écartée |
| --- | --- | --- |
| ED1 | **`packages/client` (`@surge-media/client`) + `packages/vue` (`@surge-media/vue`)** ; logique écrite une fois dans le client (choix de l'utilisateur, conforme à l'architecture B § 7) | tout dans le paquet Vue, client extrait plus tard |
| ED2 | Trois modes d'identification : objet `Media` fourni par le back, **clé publique**, **jeton délégué** via `getToken()` ; jamais de secret dans le navigateur | jetons de session propres aux composants |
| ED3 | Envois en **XHR** (progression), lectures en `fetch` ; cache ETag côté client | tout en `fetch` (sans progression d'envoi) |
| ED4 | Préfixe **`Sm`** pour les composants (`SmImage`…), composables `use…` sans préfixe | `SurgeImage`, `MediaImage` |
| ED5 | Le client stocke et échange des **identifiants de média stables** (indépendants des versions), réhydratés par `ids` | stocker des URL |
| ED6 | Constructeurs d'URL **canoniques** reprenant la logique pure du core, recoupés par des tests | laisser le serveur rediriger (301) |
| ED7 | Politique de transformation respectée par chaque composant (§ 3.3) ; préréglages en repli | paramètres libres seulement |
| ED8 | **Recadrage non destructif** par chaîne de transformation stockée par l'application ; le point d'intérêt reste une modification du média (nouvelle version) | recadrage qui remplace l'original |
| ED9 | **i18n intégrée** (fr par défaut, en), surcharges par `messages`, `Intl` | dépendance à vue-i18n |
| ED10 | Composants **sans dépendance CSS** + **thème facultatif** `style.css` (`--sm-*`, `@layer`) — choix de l'utilisateur | Tailwind requis ; aucun style |
| ED11 | **SSR** complet pour l'affichage ; `vue >= 3.5` | rendu client seulement |
| ED12 | Types publics écrits à la main + test de contrat contre les schémas zod du core | types générés depuis l'OpenAPI |
| ED13 | Client construit par tsdown, vue par Vite (mode bibliothèque) + `vue-tsc` ; tests Vitest + bac à sable `apps/playground` | Storybook / Histoire dès la 0.1 |
| ED14 | **Les quatre familles dans la 0.1**, livrées en cinq étapes E1 à E5 (§ 8) — choix de l'utilisateur | affichage seul en 0.1 |
| ED15 | **Nuxt : paquet séparé `@surge-media/nuxt` plus tard** (auto-imports, `runtimeConfig`, route d'émission des jetons) — choix de l'utilisateur | module dans `@surge-media/vue` |
| ED16 | `@surge-media/client` et `@surge-media/vue` **versionnés ensemble** (0.1.0), version minimale du core indiquée | versions indépendantes |
| ED17 | Évolutions du core (§ 6) faites dans l'étape qui en a besoin, chacune validée avec elle | toutes avant E1 |

## 8. Découpage de la 0.1

Chaque étape est d'abord **détaillée** (fichiers, dépendances épinglées, critères d'acceptation) et **validée** avant
le code, puis consignée dans le « Journal des étapes » de `setup.md`.

| Étape | Contenu |
| --- | --- |
| **E1 — Fondations + affichage** | espaces `packages/client` et `packages/vue` (build, tests, lint, i18n, thème) ; client (HTTP, erreurs, identifiants, ETag), constructeurs d'URL ; plugin ; `SmImage`, `SmPicture`, `SmVideo`, `SmMedia`, `SmThumbnail`, `SmProcessingStatus` ; bac à sable ; évolution du core n° 1 |
| **E2 — Envoi** | file d'envoi, `SmUploader`, `SmPosterCapture`, `@surge-media/client/server` + recettes ; évolution n° 2 |
| **E3 — Parcours et sélection** | `useMediaList`, dossiers, `SmMediaBrowser`, `SmMediaPicker`, `SmMediaField`, `SmFolderBreadcrumb`, `SmFolderActions`, `SmGallery`, `SmLightbox` |
| **E4 — Édition** | `SmMediaEditor`, `SmFocalPointPicker`, `SmImageCropper`, `SmPosterEditor`, `SmTextTracks`, `SmVideoChapters`, `SmTranscript` ; évolutions n° 3 et 4 |
| **E5 — Publication 0.1.0** | pages de référence fr / en du site (composants, client, recettes), README npm, mise à jour de `apps/website/src/content/docs/{,fr/}reference/sdks.md`, publication npm des deux paquets |

**Plus tard** : `@surge-media/nuxt`, React et Svelte sur le même client, HLS dans `SmVideo` (après D4), audio et
documents, envois reprenables (tus ou S3 multipart présigné), espace réservé (§ 6 n° 5).

## 9. Limites connues de l'API à prendre en compte

- Genres exposés : **IMAGE** et **VIDEO** seulement (audio et documents : phases ultérieures) ; composants extensibles par `kind`.
- Pas de streaming adaptatif (HLS : D4 à proposer) ; pas d'envoi reprenable ; fichiers ≤ 2 Gio − 1.
- Clé publique : pas de dossiers, pas de liens signés, liste seulement avec la « liste publique » du projet.
- Jeton délégué : pas de bibliothèque de l'organisation, pas de duplication, liens signés ≤ 1 h, durée ≤ 60 min.
- Formats vidéo convertis (MKV, AVI…) : `sources` vide tant que le rendu H.264 n'existe pas ; original servi en
  téléchargement (`Content-Disposition: attachment`).
- Vidéo à piste de données en attente de traitement : 503 `PROCESSING_PENDING` sur l'original et les rendus (affiche,
  dérivés et pistes jamais retenus).
- URL signées d'un média privé valables ~1 h (échéance alignée sur 15 min) : une page restée ouverte plus longtemps doit
  relire le média.

## 10. Points ouverts (à trancher avant la publication, E5)

- ~~**Licence des paquets front**~~ — **tranché le 2026-10-16 : MIT** (choix de l'utilisateur ; `LICENSE` dans chaque
  paquet, le core reste en BSL 1.1, dont le fichier exclut déjà les fichiers sous une autre licence).
- ~~**Outil de publication par paquet**~~ — **tranché le 2026-10-16 : release-it** comme le core, deux paquets
  versionnés ensemble (tag `libs-vX.Y.Z`), publication npm **par la CI seulement** (`release-libraries.yml`) ;
  `setup.md` § 17.2.
- **Nom de domaine des exemples** et compte npm (`@surge-media`, déjà prévu pour le core) ; publication de confiance
  à déclarer sur npmjs.com pour chacun des deux paquets.

---

## 11. E1 — Fondations et composants d'affichage : plan détaillé (À VALIDER)

> Proposé le 2026-10-15. Rien n'est codé tant que ce plan n'est pas validé. Décisions propres à E1 : ED18 à ED28 (§ 11.9).

### 11.1 Objectif et périmètre

À la fin d'E1, une application Vue 3.5+ affiche n'importe quel média de surgeMedia — image responsive, `<picture>`
multi-formats, vidéo avec ses sources, son affiche, ses sous-titres et l'état de son traitement — en respectant la
politique de transformation du projet, les formats activés et le caractère public ou privé du média, en français ou en
anglais, en clair ou en sombre, rendue côté serveur. **Hors E1** : envoi (E2), listes, dossiers et sélecteurs (E3),
édition (E4), documentation publique et publication (E5).

### 11.2 Évolution du core n° 1 : formats activés et dimension maximale dans `Project` (ED18)

- `apps/core/shared/schemas/api.ts` › `apiProjectSchema` : deux champs ajoutés (sans rupture), décrits en fr / en :
  - `transformFormats: ('jpg' | 'png' | 'webp' | 'avif')[]` — formats de sortie activés (`NUXT_MEDIA_TRANSFORM_FORMATS`) ;
  - `transformMaxDimension: number` — dimension maximale d'un dérivé (`NUXT_MEDIA_TRANSFORM_MAX_DIMENSION`).
  À plat, à côté de `transformPolicy` (même famille de réglages).
- `server/lib/api/serializers.ts` › `toApiProject(project, scopes, transforms)` reçoit `{ formats, maxDimension }` ; les
  routes `GET /api/v1/projects` et `GET /api/v1/projects/:projectId` passent `useTransformSettings()`.
- OpenAPI : généré depuis le registre zod (aucune autre écriture) ; vérifier `tests/openapi.test.ts`.
- Test : `toApiProject` (pur) dans `tests/api.test.ts`.
- Conséquence pour les composants : `GET /projects/:id` exige `project:read`. La clé publique l'a toujours ; **un jeton
  délégué destiné aux composants doit inclure `project:read`** (défaut de l'aide serveur d'E2, documenté). Sans cette
  lecture (objet `Media` seul, jeton sans `project:read`), le plugin accepte `defaults.formats` / `defaults.policy`,
  sinon les composants supposent les quatre formats et la politique `open`, protégés par le repli du § 11.6.
- Documentation : `setup.md` (section de l'API) et journal ; pages du site en E5.

### 11.3 Monorepo et outillage

| Élément | Choix |
| --- | --- |
| Emplacements | `packages/client`, `packages/vue`, `apps/playground` (déjà couverts par `pnpm-workspace.yaml`) |
| Paquets | `"private": true`, version `0.0.0`, `"type": "module"`, licence à décider en E5 (ED26) ; hors du workflow Release |
| Versions (alignées sur le core) | `vue` 3.5.43 (pair `^3.5.0`), `vite` 7.3.6, `@vitejs/plugin-vue` 6.0.9, `vue-tsc` 3.3.11, `typescript` ~6.0.3, `vitest` ^5.0.2, `tsdown` ^0.23.0, `eslint` ^10.12.0 + `@nuxt/eslint-config` 1.17.0 (style `stylistic` du core : 2 espaces, guillemets simples, sans point-virgule) ; nouveaux : `@vue/test-utils`, `happy-dom`, `publint` (versions exactes fixées à l'installation, dans le délai minimal de publication de pnpm) |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`, cible ES2022 (navigateurs à jour) |
| Construction | client : tsdown → `dist/index.mjs` + `.d.mts`, `sideEffects: false` ; vue : Vite mode bibliothèque (Vue et le client externes) → `dist/index.mjs` + `dist/style.css`, `.d.ts` par `vue-tsc --declaration --emitDeclarationOnly` ; `publint` sur chaque paquet |
| Scripts racine | `lint` et `test` passent à `pnpm -r` (le core et les paquets ; le site n'en a pas), `typecheck` l'est déjà ; ajout de `packages:build` et `playground:dev` |
| CI (`ci.yml`) | job « Vérifications » inchangé (il appelle les scripts racine) + étapes « Build des bibliothèques » (`pnpm --filter "./packages/*" build`, publint) et « Contrastes du thème » |
| Aperçu Claude | configuration `playground` (port 5173) dans `.claude/launch.json` |

### 11.4 `@surge-media/client` en E1

```text
packages/client/src/
├─ index.ts              exports publics
├─ client.ts             createSurgeClient({ baseUrl, projectId, publishableKey | getToken, fetch?, locale? })
├─ credentials.ts        clé publique ; jeton délégué : cache, lecture de la charge (exp, portées), renouvellement 60 s avant
│                        l'échéance, appels simultanés partagés, un rejeu sur 401 TOKEN_EXPIRED
├─ http.ts               fetch, Authorization, cache ETag des lectures (If-None-Match → 304), problem+json → SurgeApiError,
│                        Retry-After et RateLimit exposés (pas de nouvel essai automatique en E1)
├─ errors.ts             SurgeApiError { status, code, detail, requestId, retryAfter, errors }, isSurgeApiError, message(locale)
├─ types.ts              Media, MediaSource, Poster, TextTrack, MediaProcessing, Project, Preset, Me, MediaListQuery, MediaList…
├─ resources/            me(), project() (mis en cache 5 min), presets(), media.get(id), media.getMany(ids) (lots de 100,
│                        ordre conservé), media.list(query), media.iterate(query) (curseur) — écritures en E2 à E4
├─ urls/transform.ts     buildTransform(options) → segment canonique ; outputSize(options, source, max) → largeur/hauteur réelles
├─ urls/media-url.ts     mediaUrl(media, { preset | transform, format }) depuis urlTemplate ; posterUrl(media, options)
├─ urls/srcset.ts        widthCandidates (largeurs bornées à la sortie réelle, dédoublonnées, + largeur maximale de la
│                        source) ; densityCandidates (1x, 1.5x, 2x, 3x selon la marge, règle du générateur C4)
├─ urls/picture.ts       pictureFormats(enabled) : avif → webp → repli jpg (sinon png, sinon le premier activé)
├─ urls/focal.ts         focalObjectPosition (repris du core)
├─ policy.ts             transformMode(policy, credential) : free | signed | presets (§ 3.3)
├─ processing.ts         watchMedia(client, id, { interval: 5 s, signal, onChange }) : relecture avec ETag tant que
│                        pending/processing, pause onglet masqué, arrêt sur ready/failed, 403/404
├─ format.ts             formatBytes, formatClock, formatDuration, formatBitrate (repris de app/utils/format.ts)
└─ i18n/{fr,en}.ts       messages des 45 codes de API_ERRORS (+ PROCESSING_PENDING, MEDIA_FORBIDDEN de /m/) ; en: Messages
```

- **Forme canonique** : ordre `r, flip, crop, w, h, fit, g, q, bg`, valeurs par défaut retirées (`fit_cover`, `g_focal`,
  `fit`/`g` sans les deux dimensions), `dpr` appliqué puis retiré, borne `maxDimension` comme le serveur.
- **Taille réelle** (`outputSize`) : portage de l'étape « dimensions de sortie » de `server/lib/media/transform-plan.ts`
  (jamais d'agrandissement : cover/fill `k = min(1, W/w, H/h)`, contain, inside/outside, une seule dimension, borne) ;
  elle donne les descripteurs `w` exacts du srcset et les attributs `width`/`height`.
- **Tests** (Vitest, environnement node) : `fetch` simulé (en-têtes, ETag/304, renouvellement du jeton, rejeu unique,
  problem+json, `Retry-After`) ; **recoupement avec le core** : pour une table d'options, `parseTransformation` du core
  doit rendre exactement la chaîne de `buildTransform`, et `planTransform` les mêmes dimensions que `outputSize` (import de
  `apps/core/shared` et `server/lib/media/transform-plan.ts` réservé aux tests, alias `#shared`) ; **contrat** : des
  exemples de `Media`, `Project`, `Preset` passent `apiMediaSchema.parse` etc., et `expectTypeOf` compare les types du
  client à `z.input<…>` des schémas (configuration TypeScript de test séparée).

### 11.5 `@surge-media/vue` en E1

```text
packages/vue/src/
├─ index.ts                 exports (composants, composables, plugin, types)
├─ plugin.ts                createSurgeMedia({ client? | baseUrl, projectId, publishableKey | getToken, locale, fallbackLocale,
│                           messages, defaults: { formats, policy, widths, imageFormat } }) → app.use(...)
├─ context.ts               injection avec valeurs par défaut : chaque composant fonctionne sans plugin (objet Media seul)
├─ i18n/{fr,en,index}.ts    t(clé, paramètres) ; locale string ou Ref (synchronisable avec vue-i18n) ; repli locale → langue
│                           de base → fr (ED23)
├─ composables/             useSurgeClient, useProject (politique, formats, cache), usePresets, useMedia(id) (chargement,
│                           rafraîchissement des URL signées 2 min avant urlExpiresAt), useMediaUrl, useProcessing(media)
├─ components/              SmImage, SmPicture, SmVideo, SmMedia, SmThumbnail, SmProcessingStatus (+ icônes SVG en ligne)
└─ styles/                  theme.css (jetons --sm-*, clair/sombre) + components.css → dist/style.css, dans @layer surge-media
```

| Composant | Propriétés principales | Comportement |
| --- | --- | --- |
| `SmImage` | `media`, `alt`, `decorative`, `width`, `height`, `aspect` (ex. `16/9`), `fit` (`cover` par défaut avec `aspect`, `contain`, `inside`), `transform` (q, r, flip, crop, bg), `preset`, `presets` (srcset de préréglages), `format` (`webp` par défaut si activé, sinon jpg), `widths`, `sizes`, `loading` (`lazy`), `fetchpriority`, `priority`, `objectFit` (recadrage CSS sur le point d'intérêt) | srcset en largeurs (descripteurs = largeur réelle) ou en densités quand `width` est fixé sans `sizes` ; `width`/`height` toujours posés (aucun décalage) ; recadrage serveur centré sur le point d'intérêt ; politique `presets` → préréglages ; `signed` sans signature → préréglages ; `alt` = prop > `altText` > avertissement en développement ; repli du § 11.6 ; événements `load`, `error` |
| `SmPicture` | mêmes propriétés + `formats`, `sources` (direction artistique : `{ media, aspect?, widths?, sizes?, transform? }`) | une `<source type>` par format activé et par media query, `<img>` de repli ; vidéo : sur son affiche |
| `SmVideo` | `media`, `controls` (vrai), `preload` (`metadata`), `lazy` (`preload="none"` jusqu'à la visibilité), `poster` (affiche dimensionnée par `urlTemplate`, `posterWidth`), `tracks` (vrai), `label`, `ambient` (muet, en boucle, lecture auto **avec bouton pause** ; jamais si `prefers-reduced-motion`), `watch` (suivi du traitement) | `<source>` dans l'ordre de `sources` ; `<track>` + `crossorigin="anonymous"` ; aucune lecture auto hors `ambient` ; sans source : cadre au bon rapport + message + « Télécharger l'original » ; traitement en attente/en cours : `SmProcessingStatus` ; erreur de lecture → requête `HEAD` sur la source : 503 `PROCESSING_PENDING` → nouvel essai après `Retry-After` (borné) ; sources renouvelées seulement si leurs URL changent, différé pendant la lecture (reprise au même instant) ; emplacements `fallback`, `processing` |
| `SmMedia` | `media` + attributs transmis | `IMAGE` → `SmImage`, `VIDEO` → `SmVideo`, autre genre → lien vers l'original (emplacement `fallback`) |
| `SmThumbnail` | `media`, `size` (160), `alt` | vignette carrée recadrée sur le point d'intérêt (image) ou l'affiche (vidéo), sinon icône du genre ; durée visible `aria-hidden` + durée en toutes lettres `sr-only` ; pastille d'état (en attente, en cours, échec) |
| `SmProcessingStatus` | `processing`, `live` (annonces) | texte de l'état (porteur du sens) + icône fixe ; `<progress max="1">` nommé quand `progress` est connu ; `role="status"` annoncé aux seules transitions (début, fin, échec) |

### 11.6 Repli d'une image (ED20)

1. srcset choisi (formats activés, politique) ; 2. erreur de chargement → **original** (`media.url`, toujours servi pour
une image publique ou signée, sans transformation) ; 3. nouvelle erreur → état `error` : cadre réservé, texte alternatif
visible, événement `error`. Protège des réglages inconnus (formats, politique) et des liens signés expirés.

### 11.7 Thème facultatif

- Jetons : `--sm-color-bg`, `-surface`, `-fg`, `-muted-fg`, `-border`, `-primary`, `-primary-fg`, `-success`, `-warning`,
  `-danger`, `--sm-focus-ring`, `--sm-radius`, `--sm-font` (`inherit`) ; valeurs initiales reprises de l'administration.
- Sombre : `@media (prefers-color-scheme: dark)` (sauf `.light` / `[data-theme="light"]`) et `.dark` / `[data-theme="dark"]`.
- Tout dans `@layer surge-media` ; classes `sm-*` stables ; sans le fichier, les composants restent utilisables (structure,
  dimensions et `aspect-ratio` posés en attributs ou styles en ligne minimaux).
- `pnpm --filter @surge-media/vue a11y:contrast` : portage de `apps/core/scripts/check-contrast.ts` (texte 4.5:1, bordures
  et focus 3:1, clair et sombre).

### 11.8 Bac à sable `apps/playground` (ED25)

- Vite + Vue, port 5173, pages : Images (srcset, `<picture>`, cadrages, point d'intérêt, préréglages), Vidéos (sources,
  affiche, sous-titres, traitement, `ambient`), Privé (jeton délégué), Politiques (`open` / `signed` / `presets`),
  Replis ; sélecteurs de langue et de thème.
- `apps/playground/.env.local` (ignoré par git : `.env.*` à la racine ; modèle `.env.example`) : `SURGE_BASE_URL`
  (`http://localhost:3000`), `SURGE_PROJECT_ID`, `SURGE_PUBLISHABLE_KEY`, `SURGE_SECRET_KEY`. La clé secrète n'est lue que
  par un intergiciel du serveur Vite (`/api/token` → `POST /api/v1/projects/:id/delegated-tokens`, portées `project:read`
  + `media:read`, 15 min) ; jamais de préfixe `VITE_`, jamais dans le bundle.
- Données : un projet dédié « Bac à sable » dans la base de dev, origine `http://localhost:5173`, clés de test, quelques
  médias copiés (duplication) — créés par un script de test, supprimables, sans toucher aux données de l'utilisateur ;
  valeurs des clés jamais affichées.

### 11.9 Décisions d'E1

| N° | Décision | Alternative écartée |
| --- | --- | --- |
| ED18 | `Project.transformFormats` + `Project.transformMaxDimension` (à plat) ; jetons délégués des composants avec `project:read` | nouvelle route `/config` ; champs dans `/me` |
| ED19 | Les composants reçoivent un **objet `Media`** ; le chargement par identifiant passe par `useMedia(id)` (rendu serveur déterministe) | propriété `mediaId` qui charge elle-même |
| ED20 | Repli d'une image : srcset → original → état d'erreur (§ 11.6) | aucun repli |
| ED21 | Largeurs par défaut `320, 480, 640, 768, 1024, 1280, 1600, 1920, 2560`, bornées à la sortie réelle ; densités quand `width` est fixé ; `SmImage` en WebP par défaut, `SmPicture` AVIF + WebP + JPEG | AVIF par défaut (premier encodage plus lent) |
| ED22 | Vidéo : **lecteur natif** seulement en 0.1 (commandes accessibles du navigateur), mode `ambient` avec bouton pause, détection du 503 par `HEAD` | lecteur personnalisé dès la 0.1 |
| ED23 | Langue : chaîne ou `Ref` ; repli locale → langue de base → fr ; messages surchargeables | dépendance à vue-i18n |
| ED24 | Icônes en SVG en ligne (tracés repris de Lucide, licence ISC mentionnée) | dépendance `@lucide/vue` |
| ED25 | Bac à sable `apps/playground` + intergiciel Vite qui émet les jetons délégués depuis `.env.local` | Storybook ; clé secrète côté navigateur |
| ED26 | Paquets `"private": true`, `0.0.0`, hors publication jusqu'à E5 | publier une 0.0.x de préversion |
| ED27 | Outillage aligné sur le core (versions du § 11.3), ESLint `@nuxt/eslint-config` en mode `stylistic` | configuration ESLint propre aux paquets |
| ED28 | Client sans nouvel essai automatique en E1 (`Retry-After` exposé) ; nouveaux essais avec la file d'envoi (E2) | nouvel essai automatique des lectures |

### 11.10 Ordre de réalisation

1. Core n° 1 (schéma, sérialiseur, routes, tests, OpenAPI) — appliqué au serveur de dev par rechargement, sans migration.
2. Squelettes `packages/client` et `packages/vue` (package.json, tsconfig, build, Vitest, ESLint), scripts racine, CI.
3. Client : http, identifiants, erreurs, types + tests de contrat.
4. Constructeurs d'URL + tests de recoupement avec le core.
5. Vue : plugin, i18n, contexte, thème ; `SmImage`, `SmPicture`, `SmThumbnail`.
6. `SmVideo`, `SmProcessingStatus`, `SmMedia`, `useMedia`, `useProcessing`.
7. Bac à sable, données de test, essais réels, axe, contrastes.
8. Documentation : `setup.md` (nouvelle section « Bibliothèques front » + étape 26 du journal), `project-context.md`
   (nouvelle section des paquets), état d'E1 en tête de ce document.

### 11.11 Critères d'acceptation

1. `pnpm install`, puis à la racine `pnpm lint`, `pnpm typecheck`, `pnpm test` réussis (core + paquets) ; builds des
   deux paquets (ESM, types, `style.css`) et `publint` sans erreur.
2. Recoupement avec le core (forme canonique, tailles réelles) et tests de contrat au vert.
3. Rendu serveur (`renderToString`) stable pour chaque composant ; import des paquets sans `window` (environnement node).
4. Bac à sable sur le core local : aucune redirection 301 ni erreur 400/403 sur les dérivés demandés (onglet réseau) ;
   projet `presets` servi par préréglages ; média privé affiché avec un jeton délégué ; vidéo avec sources, affiche et
   sous-titres ; vidéo en traitement suivie jusqu'à « prête » ; format désactivé → repli sur l'original.
5. axe : 0 violation sur les pages du bac à sable en fr / en × clair / sombre ; contrastes AA du thème ; bouton pause du
   mode `ambient` atteignable au clavier ; aucune lecture automatique ailleurs.
6. Core : `GET /api/v1/projects/:id` renvoie `transformFormats` et `transformMaxDimension`, OpenAPI fr/en à jour, tests
   du core verts, données de l'utilisateur intactes.

### 11.12 Risques

- **Vite mode bibliothèque** et `.d.ts` des SFC : si `vue-tsc` pose problème, repli sur `unplugin-vue` + tsdown.
- **Délai minimal de publication de pnpm** : une version trop récente est refusée (comme astro 7.4.0) ; prendre la
  précédente, sans exception ajoutée.
- **Import du core dans les tests** du client (alias `#shared`, zod résolu depuis `apps/core`) : configuration de test
  dédiée ; si cela devient fragile, copier des tables de cas générées par le core.
- **`HEAD` sur une source vidéo** : CORS `*` et `Retry-After` exposés par `/m/` (§ 9.23) ; à vérifier derrière un CDN
  qui ne transmettrait pas `HEAD`.

---

## E1 — état de l'implémentation (2026-10-15)

Fait dans l'ordre du § 11.10 ; référence d'exploitation : `setup.md` § 17 et étape 26 ; contexte : `project-context.md` § 9.25.

### Écarts et précisions

- **Core** : en plus de `Project.transformFormats` / `transformMaxDimension`, `vite` **7.3.6** ajouté aux dépendances de
  développement du core. L'installation des nouveaux paquets avait fait résoudre par pnpm les dépendances « pair » de
  Nuxt, `@tailwindcss/vite`, Vitest… sur le **Vite 8.3.4** du site (Astro) ; `nuxt typecheck` échouait
  (`nuxt.config.ts` : `Plugin<any>[]` non assignable à `PluginOption`). Avec la version épinglée, le verrou du core ne
  change plus que par des dépendances « pair » facultatives (mêmes versions).
- **Client** : `buildTransform` **borne** les dimensions à `maxDimension` en gardant le rapport (le serveur, lui,
  refuserait `w` > borne) ; `parseTransform` (lecture légère d'une transformation de préréglage) et `BUILTIN_PRESETS`
  (recoupé avec le core) ajoutés ; une valeur impossible lève une `RangeError` (erreur de programmation).
- **Vue — build** : entrée de build distincte (`src/entry.ts` importe la feuille de style) pour que les déclarations
  (`dist/index.d.ts`) ne contiennent pas d'import CSS ; `src/index.ts` reste l'entrée typée.
- **Vue — repli au montage** : la vérification d'une erreur antérieure à l'hydratation passe par `img.decode()` (échec
  = image réellement illisible). Avec `complete && naturalWidth === 0` seul, une image en cache pas encore décodée (onglet
  masqué) basculait à tort sur l'original (vu dans le bac à sable).
- **Vue — textes** : `image.unavailable` retiré (le cadre d'erreur affiche le texte alternatif, rien d'autre à dire).
- **Licence** : champ `license` à `BUSL-1.1` (celle du dépôt) en attendant la décision d'E5 ; paquets `private`.

### Vérifications

- Tests : client **67** (dont recoupement de 25 transformations × 5 sources × 2 formats avec `parseTransformation` /
  `planTransform`, contrat de 9 types vérifié par `tsc` — une sonde volontairement fausse échoue bien), vue **23**
  (rendu serveur dans Node, montage dans happy-dom), core **554** (+1 : contrat `Project`).
- Bac à sable sur le core de dev (projet de test créé par script dans la base de dev, données de l'utilisateur
  intactes) : dérivés en 200 sans 301, AVIF par `<picture>`, privé signé, clé publique (403 d'une autre origine),
  politiques `presets` et `signed`, repli réel 404 → original → cadre d'erreur, 304 de revalidation ; axe 0 violation
  (20 combinaisons) ; 375 px sans débordement ; bouton pause 44 × 44 au clavier.
- Non vérifié en réel : la retenue 503 `PROCESSING_PENDING` d'une vidéo (aucune vidéo à piste de données disponible ;
  couverte par un test de composant) et une vidéo en cours de traitement (états simulés dans la page « Replis »).
