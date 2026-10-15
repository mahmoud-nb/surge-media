# Phase E — Bibliothèques front : `@surge-media/client` et `@surge-media/vue`

> **Statut : ÉTUDE VALIDÉE (2026-10-15)** — inventaire des composants et des fonctionnalités médias réalisables côté
> front, d'après ce que l'API du core permet aujourd'hui (vérifié dans le code). Choix de l'utilisateur du 2026-10-15 :
> découpage **client + vue** (ED1), **thème facultatif** (ED10), **les quatre familles dans la 0.1** livrées par étapes
> E1 à E5 (ED14), **Nuxt dans un paquet séparé plus tard** (ED15). Les autres décisions sont des recommandations
> acceptées avec le plan ; chaque étape (E1…E5) sera **détaillée puis validée avant d'être codée**, comme les phases B à D.
> Aucun code écrit à ce stade.
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

- **Licence des paquets front** : MIT conseillée (`project-context.md` § 22) ; d'ici là, `"private": true` dans leurs
  `package.json`.
- **Outil de publication par paquet** : release-it comme le core, ou changesets pour un monorepo multi-paquets.
- **Nom de domaine des exemples** et compte npm (`@surge-media`, déjà prévu pour le core).
