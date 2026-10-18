# Phase E — Bibliothèques front : `@surge-media/client` et `@surge-media/vue`

> **Statut : ÉTUDE VALIDÉE (2026-10-15)** — inventaire des composants et des fonctionnalités médias réalisables côté
> front, d'après ce que l'API du core permet aujourd'hui (vérifié dans le code). Choix de l'utilisateur du 2026-10-15 :
> découpage **client + vue** (ED1), **thème facultatif** (ED10), **les quatre familles dans la 0.1** livrées par étapes
> E1 à E5 (ED14), **Nuxt dans un paquet séparé plus tard** (ED15). Les autres décisions sont des recommandations
> acceptées avec le plan ; chaque étape (E1…E5) sera **détaillée puis validée avant d'être codée**, comme les phases B à D.
> **E1 VALIDÉE tel quel puis FAITE le 2026-10-15** (§ 11, décisions ED18 à ED28 ; `setup.md` § 17 et étape 26 ;
> état, écarts et vérifications : section « E1 — état de l'implémentation » en fin de document). Suite : **E2 (envoi)**,
> choisie avant le paquet React (2026-10-17) : plan du § 12 (ED29 à ED38) **validé tel quel puis FAIT le 2026-10-17**
> (`setup.md` § 17 et étape 27 ; `project-context.md` § 9.26 ; section « E2 — état de l'implémentation » en fin de
> document). Suite : **E3 (parcours et sélection)**, à détailler et faire valider.
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
  vérifiés par script ; classes `sm-*` stables documentées ; aucun Tailwind imposé. Depuis le 2026-10-18, écrit dans
  `@surge-media/client` (`@surge-media/client/style.css`) et repris par chaque librairie (`@surge-media/vue/style.css`).
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
- **Après E1 (2026-10-17)** : `imageSourceSet` et `parseAspect` déplacés de `@surge-media/vue` vers `@surge-media/client`
  (`src/urls/image-sources.ts`, tests compris), choix de l'utilisateur, conforme à ED1 : React, Svelte et les librairies locales
  (guide du site `reference/framework-integration`) les réutilisent.
- **Avant le paquet React (2026-10-18)** : le reste de la logique sans framework (textes fr / en et `createTranslate`,
  tracés des icônes, réglages effectifs et préréglages, attributs et styles en ligne des images, `<picture>`, vignettes,
  vidéos, état du traitement, affichage de l'envoi, délai de relecture) et le **thème** (`@surge-media/client/style.css`,
  script de contraste) passent dans le client (`src/ui/`, `src/styles/`), choix de l'utilisateur conforme à ED1 ;
  `@surge-media/vue/style.css` et l'API publique de Vue inchangés (`project-context.md` § 9.27).
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

---

## 12. E2 — Envoi : plan détaillé (À VALIDER)

> Proposé le 2026-10-17, après le choix de l'utilisateur de faire **E2 avant le paquet React**. Rien n'est codé tant
> que ce plan n'est pas validé. Décisions propres à E2 : ED29 à ED38 (§ 12.7). Sources vérifiées : `server/api/v1/
> projects/[projectId]/media/index.post.ts`, `…/poster.put.ts`, `server/api/v1/me.get.ts`, `server/lib/api/{writes,
> context,problem}.ts`, `server/lib/media/{upload,limits}.ts`, `server/lib/access/delegated.ts`, `shared/schemas/api.ts`,
> `shared/utils/media.ts`, `server/middleware/api-v1.ts` (CORS), `app/components/admin/MediaUploader.vue`,
> `app/composables/useMediaUpload.ts`, `app/utils/video-frame.ts`.

### 12.1 Objectif et périmètre

À la fin d'E2, une application Vue envoie des images et des vidéos dans un projet avec un **jeton délégué** : sélection
native, dépôt ou collage, pré-contrôle exact (types, tailles, nombre d'envois restants), file avec progression,
annulation et nouvel essai, affiche capturée dans le navigateur pour les vidéos, messages précis en fr / en, accessible.
Son back-end émet les jetons avec **`@surge-media/client/server`**. **Toute la logique d'envoi est dans le client**
(file, pré-contrôle, requête, capture) : le futur paquet React la réutilisera telle quelle (le déplacement de la logique
d'affichage encore dans `@surge-media/vue` reste un préalable du paquet React). **Hors E2** : modification des
métadonnées et remplacement du fichier après l'envoi (E4), sélecteur avec onglet d'envoi (E3), envois reprenables (plus tard).

Ce que l'API permet déjà (vérifié) : `POST …/media` en `multipart/form-data` (champs `title`, `altText`, `visibility`,
`folderId`, puis `file`), type reconnu d'après le contenu et refusé dès les premiers octets, limite par genre (images
25 Mio, vidéos 512 Mio par défaut), 60 s sans donnée → 408, contraintes du jeton délégué (`maxFiles` compté de façon
atomique par `jti`, `maxSize`, `types`, `visibility` et `folderId` imposés), débit 60 envois/min par (émetteur, IP),
CORS des écritures (`POST`, `PUT`, `Authorization`, `Location` et `Retry-After` exposés).

### 12.2 Évolutions du core

**N° 2 — Règles d'envoi effectives dans `GET /me` (ED29).** Aujourd'hui `/me` ne rend que les contraintes brutes du jeton
(`delegated.upload`) : ni les types de l'installation (qui dépendent du traitement des vidéos), ni les limites par genre,
ni le nombre d'envois restants. Nouveau champ `upload`, `null` quand l'identifiant n'a pas `media:upload` :

```ts
upload: {
  // Types de l'installation en ce moment ∩ `types` du jeton ; limite du genre bornée par `maxSize` du jeton.
  types: { mimeType: string, extension: string, kind: 'image' | 'video', maxSize: number, converted: boolean }[]
  remaining: number | null   // jeton avec maxFiles : maxFiles − envois réservés ; sinon null
  visibility: 'public' | 'private' | null   // imposée par le jeton
  folderId: string | null                   // imposé par le jeton
} | null
```

Calcul par une fonction pure (`effectiveUploadRules`, réutilise `rulesFor` et `acceptedMimeTypes`), testée ; `remaining`
lit `DelegatedTokenUsage` par sa clé primaire. Schéma zod + OpenAPI fr / en. Pas de nouvelle route : `/me` est lisible
par tout identifiant.

**N° 2 bis — Membres d'extension des problèmes d'envoi (ED30).** `toProblem` garde aujourd'hui `maxSize`, `accepted` et
`timeout` dans le seul `detail` anglais. Ajout de membres d'extension RFC 9457 : 413 `FILE_TOO_LARGE` → `maxSize`
(octets, limite du genre reconnu), 415 `UNSUPPORTED_TYPE` → `accepted` (types MIME), 408 `UPLOAD_TIMEOUT` → `timeout`
(secondes). Schéma `Problem` de l'OpenAPI complété ; `detail` inchangé ; tests de `problemBody`.

**N° 2 ter — Affiche d'une vidéo envoyée par le même jeton (ED31).** `PUT …/poster` exige `media:write`, qui permet
aujourd'hui de modifier **tout** média du projet (évolution n° 3, prévue en E4). Pour que la capture de l'affiche ne
demande pas ce droit : un jeton délégué avec `media:upload` peut définir l'affiche d'une vidéo **envoyée par le même
émetteur et le même sujet** (`uploadedByTokenId`, `uploadSubject`), **depuis moins d'une heure** (durée maximale d'un
jeton délégué, donc un jeton renouvelé entre-temps convient) et **sans affiche** ; sinon 403 `INSUFFICIENT_SCOPE` comme
aujourd'hui. Description OpenAPI fr / en ; tests (même sujet, autre sujet, autre émetteur, vidéo ancienne, affiche existante).

### 12.3 `@surge-media/client` en E2

```text
packages/client/src/
├─ upload/rules.ts        UploadRules (de /me) ; checkFile(file, rules, kinds?) → null | { code, maxSize?, accepted? } :
│                         type annoncé par le système (alias : video/x-m4v, image/jpg, types Windows des .ts/.avi…),
│                         extension pour les formats convertis (.mkv, .mts…), plus grande limite si le type est inconnu ;
│                         acceptAttribute(rules, kinds?), acceptedExtensions(rules, kinds?), maxSizeFor(rules, kind)
│                         — repris d'app/composables/useMediaUpload.ts
├─ upload/request.ts      envoi d'un fichier : XMLHttpRequest dans le navigateur (progression), sinon fetch (Node, edge :
│                         sans progression) ; champs texte avant `file` ; 401 TOKEN_EXPIRED → jeton renouvelé, un seul
│                         nouvel essai ; problem+json → SurgeApiError (extensions comprises) ; AbortSignal → AbortError
├─ upload/queue.ts        createUploadQueue(options) : file sans framework (état immuable + subscribe), § ci-dessous
├─ upload/video-frame.ts  captureVideoFrame(file) : port d'app/utils/video-frame.ts (10 % de la durée, 5 s au plus, image
│                         presque noire évitée, 15 s au plus) ; null hors navigateur ou si le codec n'est pas décodable
└─ server.ts              entrée `@surge-media/client/server` (§ ci-dessous)
```

- **Client** : `media.upload(file, fields?, { onProgress, signal, filename })` → `Media` ; `media.setPoster(id, image,
  { time, signal })` → `Media` ; `uploadRules()` → `UploadRules | null` (lecture de `/me`, cache ETag).
- **`SurgeApiError.extensions`** (`maxSize`, `accepted`, `timeout`) ; messages à paramètres (« Ce fichier dépasse
  25 Mo. », « Types acceptés : JPG, PNG, WebP. »), tailles par `formatBytes` dans la langue demandée.
- **File d'envoi** `createUploadQueue({ client, rules, kinds, fields, concurrency: 2, autoStart: true, capturePoster:
  true, maxRetries: 3 })` :
  - élément : `{ id, file, name, size, kind, status, progress, media, error, attempts, fields }`, `status` parmi `queued`,
    `uploading`, `poster`, `done`, `error`, `canceled` ; `progress` de 0 à 1 (null si inconnu) ;
  - `add(files, fields?)` : pré-contrôle immédiat (refus visible sans rien envoyer) ; `remaining` décompté localement
    (fichiers au-delà → `UPLOAD_LIMIT_REACHED` sans envoi) ; `start()` (avec `autoStart: false`), `cancel(id)` (requête
    interrompue : le serveur supprime le fichier temporaire, aucun média créé), `retry(id)`, `remove(id)`, `clear()`,
    `snapshot()`, `subscribe(listener)`, `destroy()` ; rappels `onUploaded`, `onError`, `onSettled` ;
  - nouvel essai automatique seulement pour 429 `RATE_LIMITED`, 503 `SERVER_BUSY` et une erreur réseau, après
    `Retry-After` (sinon 2, 4, 8 s), 3 fois au plus ; jamais pour un refus 4xx (413, 415, 422, 403) ; 408 → nouvel essai
    manuel ;
  - vidéo créée : affiche capturée **pendant** l'envoi, puis `setPoster` ; un échec laisse la vidéo sans affiche (le
    serveur en extrait une si le traitement des vidéos est actif).
- **Entrée serveur** (ED37) :

  ```ts
  import { createDelegatedToken, UPLOAD_SCOPES } from '@surge-media/client/server'

  const { token, expiresAt, scopes } = await createDelegatedToken({
    baseUrl, projectId, secretKey,
    scopes: UPLOAD_SCOPES, // project:read, media:read, media:upload
    subject: String(user.id),
    origin: 'https://app.example.com',
    upload: { maxFiles: 10, maxSize: 50 * 1024 * 1024, visibility: 'private' },
    expiresIn: 900,
  })
  ```

  `DISPLAY_SCOPES` et `UPLOAD_SCOPES` exportés ; refuse de s'exécuter dans un navigateur (`SECRET_IN_BROWSER`) ; erreurs
  `SurgeApiError`. Build : deuxième entrée tsdown (`dist/server.mjs`), `exports["./server"]` ; l'entrée principale ne
  l'importe jamais (vérifié par `pack-smoke`).
- **Tests** (Vitest, node) : règles (intersection, alias, extensions converties, tailles), requête (XHR simulé :
  progression, problème avec extensions, rejeu sur 401, annulation ; chemin fetch), file (concurrence, annulation, nouvel
  essai, nouveaux essais automatiques avec horloge simulée, `remaining`, affiche), entrée serveur (corps, erreurs, refus
  dans un navigateur) ; **contrat** : `UploadRules` et `Me` comparés à `apiMeSchema` (`expectTypeOf`).

### 12.4 `@surge-media/vue` en E2

- **Composables** : `useUploadRules()` → `{ rules, pending, error, refresh }` (`null` sans droit d'envoi) ;
  `useUploadQueue(options)` → éléments réactifs (`shallowRef`) + méthodes de la file du client, détruite au démontage.
- **`SmUploader`** :

| Propriétés | Rôle |
| --- | --- |
| `kinds` (`['image', 'video']`), `multiple` (vrai) | genres et nombre de fichiers proposés (bornés par les règles du jeton) |
| `visibility`, `chooseVisibility` (faux), `folderId` | champs envoyés ; un choix imposé par le jeton l'emporte et masque le champ |
| `details` (faux) | faux : envoi dès la sélection ; vrai : titre et texte alternatif (images) par fichier, puis « Envoyer » |
| `capture` (`user` / `environment`) | appareil photo du mobile |
| `concurrency` (2), `posterCapture` (vrai), `confirmLeave` (vrai), `disabled` | file, affiche, confirmation avant de quitter la page pendant un envoi |

  Événements `uploaded(media)`, `error(item)`, `done(medias)`, `change(items)` ; emplacements `label`, `help`, `item`.
- **Accessibilité** : champ de fichier natif avec bouton libellé visible ; aide (types et taille maximale par genre,
  envois restants) reliée par `aria-describedby` ; dépôt et collage en complément sur la zone ; file en `<ul>`, chaque
  ligne avec nom, taille, `<progress>` nommé par le fichier, état en texte (jamais la couleur seule), boutons Annuler /
  Réessayer / Retirer nommés avec le fichier (cibles ≥ 24 px, 44 px avec le thème), aperçu local décoratif des images ;
  annonces `role="status"` une fois par fichier terminé et un résumé en fin de file, jamais à chaque pourcentage ; focus
  déplacé sur la ligne suivante (ou le bouton d'envoi) après « Retirer » ; sans droit d'envoi : composant désactivé avec
  un message (et un avertissement en développement).
- **SSR** : champ et aide rendus côté serveur (règles inconnues : texte générique), aucun accès à `window` à l'import.
- **Thème** : classes `sm-uploader*` sur les jetons existants ; nouvelles paires de couleurs ajoutées au script de contrastes.
- **Textes** : `upload.*` en fr / en (libellés, aide par genre, états, annonces, boutons).
- **Tests** : rendu serveur, montage happy-dom avec un client simulé (états de la file, annulation, nouvel essai, mode
  `details`, composant désactivé), annonces.

### 12.5 Bac à sable

- Page « Envoi » : `SmUploader` en envoi direct, en mode `details` et pour les vidéos (affiche), règles du jeton affichées.
- `POST /api/token` du serveur Vite émis avec **`createDelegatedToken`** (premier usage réel de l'entrée serveur) ;
  `{ purpose: 'upload' }` → `UPLOAD_SCOPES`, `maxFiles` 20, `maxSize` 50 Mio, origine du bac à sable, 15 min.
- Envois dans le seul projet « Bac à sable » (données de test, supprimables par le script de nettoyage ; données de
  l'utilisateur intactes).

### 12.6 Documentation

`setup.md` (§ 17 : envoi, route d'émission des jetons ; étape 27 du journal), `project-context.md`, état d'E2 en fin de ce
document ; site fr / en : section « Envoyer des fichiers » de `reference/sdks` (`SmUploader`, route de jetons pour Node /
Express, Nuxt, Next.js et en HTTP pour les autres langages), tableau des paquets à jour ; README des deux paquets.

### 12.7 Décisions d'E2

| N° | Décision | Alternative écartée |
| --- | --- | --- |
| ED29 | Règles d'envoi **effectives** dans `GET /me` (`upload` : types avec leur limite, envois restants, visibilité et dossier imposés) | nouvelle route `/upload-rules` ; champs dans `Project` (ne dépendent pas du jeton) |
| ED30 | Membres d'extension RFC 9457 `maxSize`, `accepted`, `timeout` sur les problèmes d'envoi | lire le `detail` anglais |
| ED31 | Affiche définie avec `media:upload` pour une vidéo du même émetteur et du même sujet, de moins d'une heure, sans affiche | exiger `media:write` (modifie tout le projet jusqu'à E4) ; affiche dans la même requête (retarde l'envoi jusqu'à 15 s) |
| ED32 | Toute la logique d'envoi dans le client (file sans framework, `subscribe`) ; Vue n'ajoute que la réactivité et l'interface | file écrite en composable Vue (à refaire pour React) |
| ED33 | XMLHttpRequest dans le navigateur (progression), fetch ailleurs (sans progression) | fetch avec flux (progression seulement dans Chrome, HTTP/2) |
| ED34 | Concurrence 2 ; nouvel essai automatique seulement pour 429, 503 et une erreur réseau (3 au plus, `Retry-After`) ; 408 et refus 4xx : manuel ou aucun | nouvel essai de toute erreur |
| ED35 | `SmPosterCapture` remplacé par l'option `capturePoster` de la file (automatique, comme l'administration) ; choix manuel de l'image dans `SmPosterEditor` (E4) | composant séparé |
| ED36 | Titre et texte alternatif saisis **avant** l'envoi (mode `details`) : un jeton d'envoi ne peut pas modifier un média ensuite ; envoi immédiat par défaut | `PATCH` après l'envoi (exige `media:write`) |
| ED37 | Entrée `@surge-media/client/server` dans le même paquet, refusée dans un navigateur, `createDelegatedToken` + `DISPLAY_SCOPES` / `UPLOAD_SCOPES` | paquet `@surge-media/server` séparé |
| ED38 | Pas d'envoi reprenable ni découpé en E2 (2 Gio − 1 au plus, 60 s sans donnée → 408) | tus ou S3 multipart (plus tard) |

### 12.8 Ordre de réalisation

1. Core : évolutions n° 2, 2 bis et 2 ter, tests, OpenAPI (serveur de dev rechargé, sans migration).
2. Client : types, règles, requête, `media.upload`, `media.setPoster`, `uploadRules`, extensions des erreurs ; tests.
3. Client : file d'envoi et capture d'affiche ; tests.
4. Client : entrée serveur, build à deux entrées, `exports`, publint, `pack-smoke` ; tests.
5. Vue : `useUploadRules`, `useUploadQueue`, `SmUploader`, textes, thème ; tests.
6. Bac à sable : page « Envoi », route de jetons par l'entrée serveur ; essais réels, axe, contrastes.
7. Documentation : `setup.md`, `project-context.md`, ce document, site fr / en, README.

### 12.9 Critères d'acceptation

1. À la racine, `pnpm lint`, `pnpm typecheck` et `pnpm test` réussis (core + paquets) ; builds et publint ;
   `pnpm packages:smoke` importe `@surge-media/client/server` dans Node et vérifie son absence de l'entrée principale.
2. Core : `/me` rend `upload` (`null` pour une clé publique ; intersection effective pour un jeton délégué ; `remaining`
   qui diminue) ; problèmes 413, 415 et 408 avec leurs extensions ; affiche avec `media:upload` acceptée seulement dans
   le cas d'ED31 ; OpenAPI fr / en à jour ; tests du core verts ; données de l'utilisateur intactes.
3. Contrat : `UploadRules` et `Me` du client conformes à `apiMeSchema`.
4. Bac à sable sur le core local : image et vidéo envoyées avec progression, vidéo avec son affiche capturée ; envoi
   annulé en cours (aucun média créé) ; fichier trop gros refusé avant l'envoi, et par le serveur (413, message avec la
   taille) si le pré-contrôle est contourné ; fichier renommé d'un autre type → 415 et message ; `maxFiles` atteint →
   message sans envoi ; coupure réseau → nouvel essai ; mode `details` : titre et texte alternatif enregistrés ; visibilité
   imposée par le jeton respectée.
5. axe : 0 violation sur la page « Envoi » en fr / en × clair / sombre ; au clavier seul : choisir, annuler, réessayer,
   retirer ; une annonce par fichier ; 375 px sans débordement ; contrastes AA du thème.
6. `SmUploader` rendu par `renderToString` sans `window`.

### 12.10 Risques

- **XHR dans happy-dom** : pas d'évènements de progression d'envoi → XHR simulé dans les tests du client ; progression
  vérifiée en réel dans le bac à sable.
- **Capture d'affiche** : codec non décodable par le navigateur (HEVC d'un `.mov` sous Firefox, par exemple) → vidéo
  sans affiche (celle du serveur si le traitement est actif).
- **`maxFiles` par jeton** : un jeton renouvelé (nouveau `jti`) recommence le décompte ; le quota par utilisateur reste à
  l'application (documenté).
- **Fichier long et jeton court** : le jeton n'est vérifié qu'au début de la requête ; le fichier suivant part avec un
  jeton renouvelé si besoin.
- **`beforeunload`** ignoré par certains navigateurs mobiles : simple confort.

## E2 — état de l'implémentation (2026-10-17)

Fait dans l'ordre du § 12.8 ; référence d'exploitation : `setup.md` § 17 et étape 27 ; contexte : `project-context.md` § 9.26.

### Écarts et précisions

- **Core** : `requireApiProject` accepte une liste de portées (« l'une d'elles ») pour `PUT …/poster` (`media:write` ou
  `media:upload`, puis ED31) ; le message d'`INSUFFICIENT_SCOPE` les cite. Les règles de `/me` sont `null` dès que la portée
  `media:upload` n'est pas **déclarée** (un jeton personnel peut la déclarer sans l'avoir dans un projet : le serveur refuse
  alors l'envoi).
- **Client** : `normalizeBaseUrl` déplacé dans `src/base-url.ts` (réexporté) pour que l'entrée serveur ne contienne pas le
  client ; `file-types.ts` (table des types connus) ajouté pour nommer les types dans les messages et deviner le genre sans
  règles ; un refus du pré-contrôle est une `SurgeApiError` de statut 0 ; un envoi interrompu après la création du média
  (pendant l'affiche) finit `done`.
- **Vue** : pas de bouton « Réessayer » pour un refus définitif (`FILE_TOO_LARGE`, `UNSUPPORTED_TYPE`, `UNREADABLE_FILE`,
  `DIMENSIONS_TOO_LARGE`, `NO_FILE`, `KIND_MISMATCH`) ; aperçu local retiré s'il ne se charge pas (fichier illisible) ;
  aucune nouvelle couleur dans le thème (bordures des champs et boutons secondaires : `--sm-color-muted-fg`, 4.5:1).
- **Site** : recettes de la route de jetons pour Express et Nuxt (`createDelegatedToken`), et en HTTP (`curl`) pour les
  autres langages ; la recette Next.js prévue est laissée au paquet React. Le guide « Créer une intégration » cite les
  fonctions d'envoi.

### Vérifications

- Tests : core **566** + 9 ignorés (+12 : `tests/api-upload.test.ts`), client **95** (+21 : envoi, entrée serveur, contrat),
  vue **24** (+8 : `SmUploader` monté et rendu serveur) ; lint, typecheck (core, client, vue, bac à sable, site), i18n du
  core, contrastes des deux thèmes, builds + publint, `pnpm packages:smoke` (entrée serveur importée dans Node, absente de
  l'entrée principale).
- Sur le core de dev (projet du bac à sable, base sauvegardée avant les essais, données de l'utilisateur intactes) :
  `/me` (15 types, `remaining` 20 → 19 → 18, images 25 Mio, vidéos 50 Mio bornées par le jeton, `null` pour un jeton de
  lecture) ; 413 avec `maxSize` = 26 214 400 ; 415 avec `accepted` ; affiche posée avec `media:upload` (puis deuxième pose
  et jeton de lecture refusés en 403, affiche hors quota) ; dans le navigateur : image et vidéo envoyées par XMLHttpRequest,
  affiche capturée dans le navigateur puis `PUT …/poster`, refus d'un fichier de 26 Mio sans requête, visibilité « Privé »
  (vignette signée), mode « détails » (titre et texte alternatif enregistrés), annulation à 51 % d'un fichier de 45 Mio
  (aucun média créé, aucun fichier temporaire restant, journaux sans erreur) ; axe 0 violation sur la page Envoi
  (fr / en × clair / sombre, file remplie, champs du mode « détails ») ; 375 px sans débordement, cibles ≥ 44 px ;
  focus visible du champ de fichier au clavier.
- Site : `astro check` 0 erreur, 24 pages, 1 242 liens et ancres sans lien cassé, axe 0 violation sur les pages SDK et le
  guide (fr / en × clair / sombre × 1 280 / 375 px), aucun débordement.
- Non vérifié en réel : la limite `maxFiles` atteinte dans l'interface (20 envois) et le nouvel essai après une coupure
  réseau ou un 429 — couverts par les tests de la file.
