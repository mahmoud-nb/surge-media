# Phase D — Vidéos : envoi, stockage, gestion et diffusion directe

> **Statut : VALIDÉE (2026-10-05) — décisions DD1 à DD14 acceptées par l'utilisateur. D1 FAITE (2026-10-05)** : `setup.md`
> étape 20 et § 7.7, `.claude/project-context.md` § 9.21. **D2 VALIDÉE (2026-10-05)** : § 17 à § 27, décisions DD15
> à DD24, avec un ajout de l'utilisateur : retirer aussi les **métadonnées de l'appareil** (§ 18.3). **D2 FAITE
> (2026-10-06)** : `setup.md` étape 21 et § 7.7, `.claude/project-context.md` § 9.22. **D3 VALIDÉE (2026-10-06)** :
> § 28 à § 42, décisions DD25 à DD36 ; l'utilisateur a délégué les choix ouverts (« le plus recommandé et performant ») :
> DD28 tel que proposé (sans perte → original remplacé) ; **DD31 : diffusion publique de l'original retenue tant que le
> retrait d'une piste de métadonnées est en attente** (§ 32.4, l'alternative devient la règle) ; DD32 : liste complète.
> D4 et transverses (§ 14) : à proposer plus tard.
>
> Écarts et précisions de D2 :
> - **Appareil** : retrait par une liste de ce qui est conservé (§ 18.3), y compris boîtes de premier niveau (`uuid` portant la
>   version de Windows, XMP) ; le bourrage (`free`, `skip`, `wide`) n'est retiré que si le fichier est réécrit pour une autre raison.
> - **Préparation** : refus étendus (`cmov`, `rmra`) ; vérification = pistes, durées, dimensions, codecs identiques et 32 octets comparés
>   pour 8 blocs ; `metadata.prepared` = `[]` pour « examiné, rien à faire ».
> - **Durée WebM** : fin du fichier lue par paliers (1, 4 puis 16 Mio) pour les grappes volumineuses (4K).
> - **Affiche** : le retrait efface aussi le point d'intérêt ; le lien temporaire de l'administration couvre aussi l'affiche et les pistes
>   (extrait `<video>` d'une vidéo privée) ; le générateur d'adresses de la fiche s'applique à l'affiche.
> - **Pistes** : remplacement du fichier = nouvelle piste ; réception en mémoire (`receiveSmallUpload`) ; ordre d'ajout.
> - **Correctif hors périmètre** : `deletePrefix` du stockage local ne supprimait jamais les dérivés des anciennes versions (Flydrive
>   attend un dossier) ; corrigé, sans nettoyage automatique des fichiers déjà laissés.
> - **Migration de la base de dev** appliquée à la main (même SQL, même empreinte) : `migrate deploy` restait « database is locked »
>   tant que le serveur de dev tournait.
>
> Écarts et précisions de D1 :
> - **MP4 fragmenté** (enregistrements `MediaRecorder` des navigateurs, CMAF) : `mvhd` et les pistes n'annoncent qu'une durée nulle
>   ou minime ; la durée est tirée de `mehd`, sinon de la **fin du dernier fragment** (`tfdt` + durées des `trun`, parcours borné,
>   jamais de refus du fichier). Les WebM de `MediaRecorder` restent sans durée (« inconnue »).
> - **Remplacement** : un fichier d'un autre genre est refusé dès les premiers octets (422 `KIND_MISMATCH`), comme un type non
>   accepté (415) ou une taille dépassée (413). Après un refus, la suite du corps est **vidangée** (lue sans être écrite) : la
>   réponse part aussitôt et la connexion reste réutilisable (vérifié avec Node et h3 seuls). En développement, le relais de
>   Nitro (`httpxy`) ne transmet plus le corps après une réponse anticipée : la connexion réutilisée se bloque (dev seulement).
> - **Délai de Node** (DD5) : relevé par `server/plugins/http-timeouts.ts` (mécanisme vérifié par un banc) ; en développement, le relais
>   de Nitro garde ses propres 300 s.
> - **Analyse** : chaînes RFC 6381 aussi pour H.265 (`hvcC`), AV1, VP9 ; lieu de tournage aussi dans `ilst` (`©xyz`) ; dimensions
>   bornées à 16 384 px ; vidéo sans piste vidéo → 415 avec la précision « No video track. ».
> - **Interface** : extrait `<video>` dans la section des adresses (média public, ou après un lien temporaire) ; aide de l'envoi par
>   genre ; carte « Médias » du tableau de bord avec le nombre de vidéos.
> - Vrais fichiers de test produits par `MediaRecorder` (Chromium 152) dans le navigateur intégré : `tests/fixtures/video/` (68 Ko).
>
> **Déjà livré (2026-10-05, à la demande de l'utilisateur, indépendant de la vidéo)** : fermeture des flux de `/m/`
> interrompus par le client (§ 8), limite et délai de lecture des corps JSON, délai d'inactivité des envois (§ 6.2).
> `setup.md` : « Correctifs — 2026-10-05 ».
>
> Demande de l'utilisateur (2026-10-05) : étendre l'application et l'API pour **accepter, stocker et distribuer des
> vidéos** en plus des images. **D'abord** un CRUD simple et la **distribution directe** des fichiers, **sans
> transcodage ni traitement avancé** ; **ensuite** étude des fonctionnalités supplémentaires (transcodage, miniatures,
> optimisation réseau, formats adaptatifs…) **sans impacter la performance globale** de l'application.
>
> La feuille de route parlait d'une « phase D : vidéos et documents » : cette proposition la restreint aux **vidéos**
> (documents et audio : phases ultérieures, DD13).

---

## 1. Résumé en 10 points

1. Une vidéo est un **média comme les autres** (`kind = VIDEO`) : même espace, dossiers, visibilité, corbeille,
   remplacement versionné, duplication, déplacement, droits, journal, API v1. **Aucune migration** de base en D1.
2. Formats acceptés : **MP4, WebM, MOV** (QuickTime), reconnus **d'après le contenu** (signature + structure), jamais
   d'après le nom ou le type annoncé. MKV, AVI, 3GP, MPEG-TS, OGV… refusés (415).
3. Analyse **sans ffmpeg** : lecteur maison des en-têtes (ISO BMFF pour MP4/MOV, EBML pour WebM) en TypeScript pur,
   testé : dimensions affichées (rotation comprise), durée, codecs, présence d'audio, « faststart », lieu de tournage.
   Lecture de quelques Kio, mémoire constante, quelques millisecondes.
4. **Aucun traitement** du fichier : il est stocké et servi **tel qu'envoyé** (pas d'aperçu, pas de dérivé, pas de
   transformation par URL ; `previewUrl` et `urlTemplate` = `null`).
5. Limite d'envoi **par genre** : images 25 Mio (inchangé), vidéos **512 Mio par défaut** (`NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE`),
   plafond **2 Gio − 1 octet** (colonne `Media.size` en `Int`). Type et taille contrôlés **dès les premiers octets
   reçus** : un fichier refusé n'est pas lu jusqu'au bout.
6. Envois longs : le délai Node de **5 min pour recevoir une requête entière** est relevé (1 h, configurable) et
   remplacé par un délai d'**inactivité** (60 s sans octet reçu) ; la protection contre les en-têtes lents est conservée.
7. Diffusion par la route existante `/m/<id>/v<n>/<nom>.mp4|webm|mov` : `Range`/206, `If-Range`, `ETag`/304, HEAD,
   cache immuable pour un média public (compatible CDN), liens signés et identifiants d'API pour un média privé.
8. **Correctif de robustesse** (toutes les diffusions) : le flux du stockage est détruit quand le client interrompt
   la réponse (sinon descripteurs de fichiers ou connexions S3 restent ouverts — très fréquent en vidéo, chaque
   déplacement dans la lecture annule une requête).
9. Interface : filtre Images / Vidéos, vignette sans image (icône + durée), lecteur natif `<video>` sur la fiche
   (`preload="metadata"`, jamais de lecture automatique), avertissements (compatibilité des codecs, métadonnées en fin
   de fichier, lieu de tournage), extrait HTML `<video>`, limites par genre dans le formulaire d'envoi.
10. Principe pour la suite (DD12) : tout traitement lourd (ffmpeg) se fera **hors du processus web** (file persistante
    + processus de travail séparé, facultatif), jamais dans le chemin d'une requête ; pas de transformation vidéo « à la
    volée » par URL comme pour les images.

## 2. Ce qui existe déjà et sert tel quel

| Élément | État actuel | Effet pour la vidéo |
| --- | --- | --- |
| `MediaKind` (Prisma) | `IMAGE VIDEO AUDIO DOCUMENT OTHER` | rien à migrer |
| `Media.duration Float?`, `metadata Json?`, `width`, `height` | prévus dès l'étape 4 | remplis par le gestionnaire vidéo |
| `Media.size Int` | ≤ 2 147 483 647 sous PostgreSQL/MySQL | plafond des vidéos en D1 (DD4) |
| Gestionnaires par genre (`handlers/`, `MediaTypeHandler`) | image seulement | un `videoHandler` sans `transform` |
| `hasDerivedFiles(media)` | faux si le gestionnaire n'a pas de `transform` | pas d'aperçu, pas de pré-génération, point d'intérêt refusé (400), générateur et `transforms` = `null`, segments dérivés de `/m/` → 404 |
| `/m/` : `resolveRange`, `getStream(key, { start, end })` local et S3 | depuis B3 | lecture par plages exigée par `<video>` |
| Signatures v2, Bearer, jetons délégués sur `/m/` | B1–B4 | médias privés lisibles par `<video src="…?exp=…&sig=…">` |
| `ENABLED_MEDIA_KINDS`, `ACCEPTED_MEDIA_TYPES` | images | `API_MEDIA_KINDS`, filtre `kind`, `upload.types` des jetons délégués et OpenAPI suivent automatiquement |
| Tableau de bord (`groupBy kind`) | tous les genres | compte des vidéos déjà calculé |
| Service médias (duplication, déplacement, corbeille, purge, remplacement + `KIND_MISMATCH`) | générique | inchangé |

## 3. Périmètre de D1

**Dans D1** : formats et détection (§ 4) ; gestionnaire vidéo (§ 5) ; limites par genre et envois longs (§ 6) ;
diffusion et correctif des flux (§ 8) ; contrats admin et API v1 documentés (§ 9) ; interface (§ 10) ; tests,
`setup.md`, `project-context.md`.

**Hors D1** (étudié ensuite, § 14) : miniatures / image d'affiche, transcodage, remux « faststart », retrait des
métadonnées, streaming adaptatif (HLS/DASH), sous-titres, envois reprenables, envoi direct vers S3, S3 multipart,
fichiers > 2 Gio, audio, documents, composants `@surge-media/vue`.

## 4. Formats acceptés et détection (DD1)

| Type MIME | Extension | Reconnaissance (`sniff.ts`) | Confirmation (gestionnaire) |
| --- | --- | --- | --- |
| `video/mp4` | `mp4` | boîte `ftyp` dont les marques ne sont ni d'image (`avif`, `avis`, `heic`, `heix`, `mif1`, `msf1`…), ni QuickTime (`qt  `), ni 3GPP (`3g*`), ni audio seul (`M4A `, `M4B `) | `moov` avec au moins une piste `vide` |
| `video/quicktime` | `mov` | boîte `ftyp` de marque principale `qt  ` | idem |
| `video/webm` | `webm` | en-tête EBML `1A 45 DF A3` avec `DocType` = `webm` | `Segment` › `Tracks` avec une piste vidéo |

- L'AVIF reste reconnu **avant** le MP4 (même conteneur ISO BMFF) : une image AVIF n'est jamais prise pour une vidéo.
- **Refusés (415 `UNSUPPORTED_TYPE`)** : Matroska `.mkv` (`DocType` = `matroska`), AVI, WMV/ASF, FLV, MPEG-TS/PS, OGV,
  3GP, ancien QuickTime sans `ftyp`. Motif : lecture dans les navigateurs impossible ou aléatoire sans transcodage ;
  ils pourront être acceptés avec le transcodage (D3).
- Fichier ISO BMFF **sans piste vidéo** (audio seul) → 415 (le genre AUDIO viendra plus tard) ; structure illisible
  ou incohérente → 422 `UNREADABLE_FILE`.
- `sniff.ts` devient une **fonction pure** sur l'en-tête (`detectMimeType(header)`, testée) appelée aussi pendant la
  réception (§ 6) ; `sniffMimeType(path)` reste son enveloppe fichier.
- **Alternative** : MP4 + WebM seulement (MOV refusé). Déconseillé : c'est le format des téléphones (iPhone), et un MOV
  H.264 se lit dans les principaux navigateurs.

## 5. Analyse du fichier : gestionnaire vidéo sans ffmpeg (DD2, DD3)

**Choix (DD3)** : lecteur d'en-têtes maison, `server/lib/media/video/{isobmff,ebml,probe}.ts`, **pur** (lecture par
positions dans un descripteur de fichier, sans tout charger), testé par Vitest. Écartés pour D1 :

| Option | Pourquoi non (en D1) |
| --- | --- |
| ffprobe (binaire système ou `ffprobe-static`) | dépendance native lourde, processus externe, traçage Nitro + pnpm, Smart App Control (déjà vécu avec argon2 et oxc) ; sera nécessaire au transcodage (D3), pas à la lecture d'en-têtes |
| `mediainfo.js` (WASM, ~2–3 Mo) | robuste mais lourd pour quelques champs ; même risque de traçage que `file-type` (§ 16 du contexte) |
| `mp4box.js` | MP4 seulement (pas WebM) |

**Champs extraits** (`InspectedMedia`) :
- `width`, `height` : dimensions **affichées** — matrice `tkhd` (rotation 90/180/270 des vidéos de téléphone : largeur
  et hauteur permutées, comme l'orientation EXIF des images) ; WebM : `PixelWidth/Height` (`DisplayWidth/Height` si
  présents) ;
- `duration` (secondes, 3 décimales) : `mvhd` (sinon `mehd` des MP4 fragmentés) ; WebM : `Info › Duration ×
  TimecodeScale` ; **null** si absente (enregistrements `MediaRecorder` des navigateurs) ;
- `metadata` : `container` (`mp4` | `mov` | `webm`), `videoCodec` (`avc1`, `hvc1`, `hev1`, `av01`, `vp09`, `vp8`,
  `vp9`, `apcn`…), `audioCodec` (`mp4a`, `opus`, `vorbis`, `ac-3`… ou null), `codecs` (chaîne RFC 6381 quand elle est
  calculable, ex. `avc1.64001F,mp4a.40.2` ; sinon null), `hasAudio`, `rotation`, `bitrate` (moyen, calculé),
  `faststart` (MP4/MOV : `moov` avant `mdat`), `hasLocation` (DD11), `playback` (`broad` | `variable`, DD2).

**Garde-fous du lecteur** (fichiers hostiles) : profondeur ≤ 10, ≤ 10 000 boîtes/éléments visités, tailles 64 bits
(`largesize`) et « jusqu'à la fin » gérées, toute taille incohérente → 422 ; seules de petites boîtes sont lues en
entier (`mvhd`, `tkhd`, `mdhd`, `hdlr`, `stsd`, ≤ 1 Mio) — jamais les tables d'échantillons ; WebM : `Segment` de
taille inconnue accepté, parcours arrêté au premier `Cluster` (16 Mio d'en-têtes au plus) ; dimensions ≤ 16 384 px par
côté (contrôle de cohérence : rien n'est décodé). L'analyse vidéo **ne prend pas de place dans la file des traitements
d'images** (`runProcessing`) : elle ne fait que quelques lectures, et une file pleine renverrait 503 `SERVER_BUSY`
**après** un envoi de plusieurs minutes.

**Codecs (DD2)** : **aucun codec refusé** (le fichier est servi tel quel). Indication de compatibilité, non bloquante :
`broad` = H.264 dans MP4/MOV, VP8/VP9 dans WebM (audio AAC, MP3, Opus, Vorbis ou absent) ; `variable` = tout le reste
(HEVC des iPhone, AV1, ProRes…) → avertissement dans la fiche : « Cette vidéo risque de ne pas être lue par tous les
navigateurs ; une version compatible pourra être produite automatiquement dans une prochaine étape. »

**Limite assumée** : sans décodage, un fichier à la structure correcte mais au flux corrompu est accepté (il échouera
à la lecture). Le transcodage (D3) apportera la vérification complète.

## 6. Envoi des gros fichiers (DD4, DD5)

### 6.1 Limites par genre (DD4)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NUXT_MEDIA_MAX_UPLOAD_SIZE` | 25 Mio | **images** (inchangé, compatibilité) |
| `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` | **512 Mio** | vidéos ; plafonné à 2 147 483 647 octets (valeur invalide ou supérieure → plafond + avertissement au démarrage) |

- Au-delà de 2 Gio : migration `Media.size` / `MediaVariant.size` en `BigInt` (sérialisation, API, zod) — hors D1.
- **Contrôle pendant la réception** (`receiveUpload`) : les 256 premiers octets sont examinés **dès leur arrivée** →
  type non accepté : 415 immédiat ; sinon la limite du genre s'applique au flux (413 `FILE_TOO_LARGE`,
  `data.maxSize` = limite du genre). Le pré-contrôle `Content-Length` utilise la plus grande limite des genres admis
  pour l'appelant. Aujourd'hui un fichier refusé est d'abord entièrement reçu.
- Jeton délégué : `upload.maxSize` borné par la limite du genre détecté ; `upload.types` peut contenir les types vidéo.
- `GET /api/admin/config/media` : + `maxUploadSizes: { IMAGE, VIDEO }` (`maxUploadSize` conservé = la plus grande).

### 6.2 Délais HTTP (DD5)

- Node (`http.Server`, serveur de production Nitro **et** `nuxt dev`) coupe toute requête **non reçue en entier en
  300 s** (`requestTimeout`) : 512 Mio exigent alors plus de **14,3 Mbit/s** montants ; au-delà, 408 et envoi perdu.
- Proposition : greffon Nitro qui fixe `server.requestTimeout` = `NUXT_MEDIA_UPLOAD_TIMEOUT` (**3600 s** par défaut ;
  serveur obtenu par `event.node.req.socket.server` à la première requête, réglage lu par Node à chaque contrôle — à
  confirmer en implémentation), et **délai d'inactivité par envoi** dans `receiveUpload` (aucun octet pendant 60 s →
  arrêt, 408) pour qu'une connexion bloquée ne garde pas un fichier temporaire. `headersTimeout` (60 s, protection
  « slowloris ») inchangé.
- **Contrepartie** : `requestTimeout` vaut pour **toutes** les routes ; le relever allonge aussi la fenêtre des corps
  lents ailleurs. Or h3 lit les corps (JSON) **sans limite de taille** (vérifié dans `readRawBody` : tout est accumulé en
  mémoire) — aujourd'hui déjà, une route publique comme `POST /api/auth/login` met en mémoire un corps de n'importe quelle
  taille. D'où, hors des routes d'envoi, une **limite de corps** (1 Mio, 413 `BODY_TOO_LARGE`) et un **délai de lecture**
  (30 s, 408 `REQUEST_TIMEOUT`) : amélioration de l'existant, **livrée le 2026-10-05 avant D1** (middleware `body-limit`),
  avec le **délai d'inactivité des envois** (60 s, 408 `UPLOAD_TIMEOUT`). Reste pour D1 : relever `requestTimeout`.
- **Mandataire inverse** (documenté dans `setup.md`) : nginx `client_max_body_size`, `proxy_request_buffering off`
  (sinon nginx stocke tout le fichier avant de le transmettre), `client_body_timeout`, `proxy_read_timeout` ; équivalents
  Caddy / Traefik.
- **Espace temporaire** : chaque envoi est écrit dans le dossier temporaire du système (`TMPDIR`/`TEMP`) avant d'être
  copié vers le stockage : prévoir (envois simultanés × taille max) d'espace libre (documenté).
- Interface : avertissement du navigateur si l'on quitte la page pendant un envoi (`beforeunload`).

## 7. Stockage (DD6)

- Clés inchangées (`originals/<AAAA>/<MM>/<aléa>.<ext>`), aucun dérivé.
- Local : flux, sans changement. S3 : `PutObject` en une requête (Flydrive), **≤ 5 Go** côté AWS → compatible avec le
  plafond de 2 Gio ; `CopyObject` (duplication) idem. **Envoi S3 en plusieurs parties** (`@aws-sdk/lib-storage`) :
  plus robuste pour les très gros fichiers, proposé avec les envois reprenables (§ 14), pas en D1.

## 8. Diffusion (DD7, DD8)

- **URL** : `/m/<id>/v<n>/<nom>.mp4|webm|mov` (original uniquement). Préréglages, paramètres, `preview` → 404 pour une
  vidéo. Remplacement → version + 1 → anciennes URL redirigées (302), comme aujourd'hui.
- **Plages** : une plage par requête (206), 416, `If-Range` sur l'ETag, HEAD, `Accept-Ranges: bytes` — ce qu'utilisent
  `<video>` et les CDN. Plages multiples : fichier entier (inchangé, permis par la RFC).
- **Cache** : public → `public, max-age=31536000, immutable` (l'URL change avec le fichier ; idéal derrière un CDN via
  `NUXT_MEDIA_PUBLIC_URL`) ; lien signé → `private`, ≤ échéance ; Bearer → `private, no-cache`.
- **En-têtes** : inchangés (`nosniff`, CSP `sandbox` — sans effet sur la lecture dans `<video>` —, CORP cross-origin,
  CORS `*` pour `<video crossorigin>` + `<canvas>`, `Content-Disposition: inline`).
- **Correctif des flux interrompus (DD7)** : h3 1.15 (`sendStream`) ne fait que `stream.abort()` à la fermeture de la
  réponse ; ni le flux de fichier local ni le corps S3 n'ont cette méthode. **Vérifié le 2026-10-05** par un banc d'essai
  isolé avec le h3 du projet (1.15.11) : 20 requêtes interrompues sur 20 laissent leur fichier ouvert, 0 avec le
  correctif. Le descripteur (local) ou la connexion S3 (pool de 50 par défaut) reste pris jusqu'au redémarrage. **Les
  images sont déjà touchées** (changement de page ou de filtre pendant le chargement des aperçus, visiteur qui quitte une
  page, réseau mobile) : la limite de descripteurs (souvent 1024 sous Linux) finit par faire échouer toute E/S, l'espace
  d'un fichier purgé n'est libéré qu'à la fermeture (la suppression elle-même réussit : vérifié sous Windows 11, sémantique
  POSIX), avec S3 les lectures (diffusion **et** sources des dérivés) attendent un socket libre. Une lecture vidéo annule
  des requêtes à chaque déplacement : la saturation devient probable. Correctif : détruire le flux à la fermeture de la
  réponse, pour tous les genres. **Livré le 2026-10-05, avant D1** (`server/lib/http/stream.ts`, étape « Correctifs »
  de `setup.md`).
- **Liens de l'administration (DD8)** : aujourd'hui ~1 h (45 à 60 min restantes). Une vidéo privée plus longue
  s'interromprait à l'échéance (chaque nouvelle plage réutilise l'URL). Proposition : **6 h** (tranche d'1 h) pour les
  vidéos, images inchangées. API : `url` des médias privés inchangée (~1 h) ; la documentation conseille `POST
  …/signed-url` avec `expiresIn` ≥ durée de la vidéo (7 jours au plus).

## 9. Contrats (DD9)

**Administration** : `MediaSummary` inchangé (`kind: VIDEO`, `duration` rempli, `previewUrl: null`) ; `MediaDetail.metadata`
porte les informations vidéo (§ 5) ; filtre `kind` déjà accepté par `GET /api/admin/media` ; `transforms: null` ;
`PATCH` avec `focalPoint` → 400 (déjà) ; `PUT …/file` : image ↔ vidéo → 422 `KIND_MISMATCH` (déjà).

**API v1** : **forme du contrat `Media` inchangée** — `kind: "video"`, `width`/`height`/`duration` remplis,
`previewUrl` et `urlTemplate` `null` ; filtre `?kind=video` ; envoi et remplacement acceptent les vidéos (clé secrète,
jeton personnel, jeton délégué, contraintes `types`/`maxSize`) ; `signed-url` cible `file` (les autres cibles → 400
comme pour tout média sans dérivés). OpenAPI : descriptions mises à jour (formats et limites par genre, `413` par genre,
lecture par plages, liens signés des longues vidéos), en français et en anglais.

**Pas d'objet `video { codecs, … }` dans l'API en D1** : avec le transcodage (D3), le contrat recevra de toute façon une
liste de **sources** (rendus, types avec codecs, affiche) ; un champ ajouté maintenant risquerait d'être remplacé.

## 10. Interface d'administration (DD10)

- **Envoi** (`AdminMediaUploader`) : attribut `accept` et aide avec formats et limites **par genre** (« Images : JPG,
  PNG, WebP, AVIF, GIF, 25 Mo au plus · Vidéos : MP4, WebM, MOV, 512 Mo au plus ») ; pré-contrôle par genre ;
  progression existante ; avertissement en quittant la page pendant un envoi.
- **Médiathèque** (`AdminMediaBrowser`) : filtre « Type » (Tous / Images / Vidéos) dans l'URL (`kind=VIDEO`), affiché
  dès que plusieurs genres sont activés.
- **Carte** (`AdminMediaCard`) : **pas de `<video>` dans la grille** (24 éléments chargeant leurs métadonnées = au moins
  24 requêtes, davantage sans « faststart ») : icône `Film` (`aria-hidden`) sur fond neutre + pastille de durée
  (`1:23`, texte accessible « Durée : 1 min 23 s ») ; détails : format · dimensions · durée · taille. Les vraies
  vignettes viendront avec les affiches (D2/D3).
- **Fiche** (`/admin/media/[id]`) : lecteur natif `<video controls preload="metadata" playsinline>` (accessible au
  clavier, **jamais** `autoplay` ni `loop` — WCAG 1.4.2, 2.2.2), dimensions réservées (pas de décalage de mise en page),
  nom accessible = titre ou nom du fichier, description = texte alternatif ; texte de repli avec lien vers le fichier ;
  informations : durée, dimensions, codecs vidéo/audio, débit moyen ; **avertissements** (`UiAlert`) : compatibilité
  `variable`, métadonnées en fin de fichier (`faststart: false` : démarrage plus lent), durée inconnue, lieu de tournage
  présent (DD11) ; point d'intérêt et générateur d'adresses masqués ; extrait HTML `<video>` copiable (`UiCopyButton`).
- **Texte alternatif** : même champ (`altText`), libellé et aide adaptés au genre (« Description courte » de la vidéo,
  WCAG 1.1.1 : identification du contenu ; les sous-titres viendront en D2).
- **Tableau de bord** : carte « Médias » avec le nombre d'images **et** de vidéos.
- Tout texte en `fr.json` / `en.json` ; `pnpm i18n:check` ; axe fr/en × clair/sombre (médiathèque filtrée, carte vidéo,
  fiche avec lecteur et avertissements, formulaire d'envoi avec erreurs).

## 11. Confidentialité (DD11)

Comme les originaux d'images (EXIF), les vidéos sont **servies telles qu'envoyées, métadonnées comprises** : une vidéo
de téléphone contient souvent le **lieu de tournage** (`©xyz` dans `udta`, clé `com.apple.quicktime.location.ISO6709`
dans `meta`). D1 le **détecte** (`metadata.hasLocation`) et l'**signale** dans la fiche (média public surtout) ; le
retrait sans réencodage (remux) est proposé en D2.

## 12. Performance : garanties de D1 et règles pour la suite (DD12)

**D1 n'ajoute aucun calcul lourd** : flux partout (mémoire constante), lecture d'en-têtes de quelques Kio, rejet précoce
des envois refusés, aucune nouvelle file ni tâche de fond, diffusion par plages et cache immuable (CDN), correctif des
flux interrompus, délais relevés sans retirer la protection des en-têtes lents.

**Pas de `worker_threads` pour les envois (DD14)** : mesuré le 2026-10-05, un envoi multipart de 512 Mio traité comme
`receiveUpload` (busboy, SHA-256 au fil de l'eau, fichier temporaire) à 291 Mio/s en boucle locale laisse la boucle
d'événements **au niveau du repos** (retard max 23,6 ms contre 25,6 ms au repos : granularité des minuteries Windows).
Un envoi est fait d'E/S, exécutées hors du fil principal par libuv ; le calcul par bloc est de l'ordre de la
microseconde (estimation : ~4 % d'un cœur à 100 Mbit/s). Un fil de travail ne peut pas reprendre la socket : il faudrait
lui recopier chaque bloc, soit plus de travail. Les vrais leviers :
- analyse vidéo hors de la file des images (§ 5) ;
- **réserve de fils de libuv** (`UV_THREADPOOL_SIZE`, 4 par défaut) **partagée** par sharp et les lectures/écritures de
  fichiers : des transformations d'images simultanées peuvent retarder les E/S des envois et de la diffusion en stockage
  local → à mesurer en D1, puis documenter une valeur (et la concurrence de la file en rapport) ;
- borne facultative du nombre d'envois simultanés (refus immédiat 503 + `Retry-After`, avant de lire le corps) :
  espace temporaire et débit maîtrisés ;
- à terme, **envoi direct vers le stockage** (URL présignées S3, multipart, tus) : les octets ne transitent plus par Node.

**Règles proposées pour les traitements futurs** (à confirmer au moment d'en parler) :
1. Aucun traitement vidéo dans le chemin d'une requête : pas de transformation par URL comme pour les images (des
   minutes de calcul) ; les rendus sont produits **après l'envoi**, puis servis comme des fichiers statiques.
2. Traitements lourds dans un **processus séparé** (`surge-media worker`, éventuellement un autre conteneur ou une autre
   machine), file **persistante** en base (reprise après redémarrage), concurrence et priorité réglables, **désactivé
   par défaut** (une installation sans ffmpeg continue de fonctionner, comme en D1).
3. Le média reste utilisable (original servi) pendant le traitement ; statut visible dans l'interface et l'API.
4. Délestage de la diffusion envisageable : redirection vers une URL présignée S3 ou un CDN, `X-Accel-Redirect` (nginx)
   pour le stockage local.

## 13. Décisions à valider

| # | Décision proposée | Alternative |
| --- | --- | --- |
| DD1 | Formats **MP4, WebM, MOV** (signature + structure) ; MKV, AVI, 3GP, MPEG-TS, OGV… refusés (415) | MP4 + WebM seulement |
| DD2 | Aucun codec refusé ; codecs enregistrés ; avertissement « compatibilité variable » hors H.264 (MP4/MOV) et VP8/VP9 (WebM) | refuser HEVC/ProRes jusqu'au transcodage |
| DD3 | Analyse par un **lecteur d'en-têtes maison** (TypeScript pur, testé), sans ffprobe ni WASM | `mediainfo.js` (WASM) ; ffprobe |
| DD4 | `NUXT_MEDIA_MAX_VIDEO_UPLOAD_SIZE` **512 Mio** par défaut, plafond **2 Gio − 1** (sans migration) ; images 25 Mio ; type et taille contrôlés **pendant la réception** | autre défaut (256 Mio, 1 Gio) ; `BigInt` dès D1 |
| DD5 | `requestTimeout` relevé à **1 h** (`NUXT_MEDIA_UPLOAD_TIMEOUT`) + **inactivité 60 s** par envoi + **limite de corps 1 Mio et délai court hors des routes d'envoi** ; mandataire documenté | laisser 5 min (envois limités par le débit du client) |
| DD6 | Stockage inchangé (S3 `PutObject` ≤ 5 Go) ; S3 multipart avec les envois reprenables | S3 multipart dès D1 |
| DD7 | Diffusion de l'original par `/m/` (Range, cache) + **destruction des flux interrompus** pour tous les genres | — |
| DD8 | Liens signés de l'administration : **6 h** pour une vidéo ; API inchangée, documentée | durée liée à celle de la vidéo |
| DD9 | Contrat `Media` de l'API **inchangé dans sa forme** ; objet de sources/codecs avec le transcodage | ajouter `video { codecs, … }` dès D1 |
| DD10 | Interface : filtre par type, carte sans image (icône + durée), lecteur natif sur la fiche seulement, avertissements, extrait `<video>`, limites par genre | première image dans la grille via `<video preload="metadata">` (coût réseau) |
| DD11 | Lieu de tournage **détecté et signalé**, pas retiré (retrait en D2) | refuser les vidéos géolocalisées ; ne rien faire |
| DD12 | Règles de performance du § 12 pour toute la suite (traitements hors requête, processus séparé, facultatif) | — |
| DD13 | Phase D = **vidéos** ; audio et documents dans des phases ultérieures ; D1 = étape 20 de `setup.md` | phase D « médias temporels » (vidéo + audio) |
| DD14 | **Pas de `worker_threads` pour les envois** (mesuré) ; analyse vidéo hors de la file des images ; réserve de fils libuv mesurée puis documentée ; borne facultative des envois simultanés | envois dans des fils de travail |

## 14. Suite envisagée (à étudier après D1, non soumise à validation aujourd'hui)

Ordre proposé du moins coûteux au plus coûteux, chaque étape facultative et mesurée :

| Étape | Contenu | Coût serveur |
| --- | --- | --- |
| **D2 — préparation sans réencodage** | remux **faststart** (déplacement de `moov`, réécriture des décalages `stco`/`co64`, faisable en TypeScript), **retrait des métadonnées** (lieu), **image d'affiche** fournie par l'utilisateur ou **capturée dans le navigateur** de l'administration au moment de l'envoi (`<video>` + `<canvas>`, aucun calcul serveur), **sous-titres WebVTT** (pistes `<track>`, priorité accessibilité WCAG 1.2.2) | faible (E/S) |
| **D3 — traitements (ffmpeg, processus séparé)** | affiches et vignettes côté serveur (aussi pour l'API), rendu compatible H.264/AAC (+ éventuellement AV1/VP9), formats refusés en D1 acceptés une fois convertis, statut de traitement, contrat `sources[]` | élevé, isolé (DD12) |
| **D4 — streaming adaptatif** | HLS (CMAF/fMP4) multi-débits, manifestes et segments signés (jeton dans le chemin plutôt qu'une signature par segment), CDN | élevé, isolé |
| Transverse | envois reprenables (tus ou S3 multipart présigné, envoi direct vers le stockage), fichiers > 2 Gio (`BigInt`), délestage de la diffusion (§ 12.4), composant `<SmVideo>` de `@surge-media/vue` | variable |

## 15. Plan de vérification de D1

- **Vitest** : `detectMimeType` (MP4/MOV/WebM/AVIF/HEIF/3GP/MKV/M4A, en-têtes tronqués) ; lecteur ISO BMFF et EBML sur
  des fichiers **synthétiques construits par les tests** (rotation, `largesize`, taille 0, MP4 fragmenté, `moov` en fin,
  lieu, codecs RFC 6381, absence de piste vidéo, tailles absurdes, boucles, `Segment` de taille inconnue, durée absente) ;
  limites par genre (pur) ; `resolveRange` inchangé.
- **Vrais fichiers sans téléchargement** : vidéos produites **localement** dans le navigateur intégré par
  `MediaRecorder` (WebM VP8/VP9, MP4 H.264 si Chromium le propose) ; vidéos de téléphone (MOV HEVC avec lieu) **si
  l'utilisateur en fournit**.
- **Scénario HTTP** (`video-test.mjs [base]`) : envois admin et API v1 (clé secrète, jeton délégué avec `types` et
  `maxSize`), 415 et 413 **précoces** (requête close avant la fin de l'envoi), 422 structure, métadonnées extraites,
  plages (206, 416, `If-Range`, HEAD, 304), média privé signé et Bearer, corbeille (404), remplacement (`KIND_MISMATCH`
  dans les deux sens), duplication, déplacement, purge **après des requêtes annulées** (fichier supprimable = flux
  fermés), délai d'inactivité (serveur isolé avec un délai court), limite de corps hors envois (413), retard de la
  boucle d'événements et des E/S pendant des envois et des transformations d'images simultanés, tableau de bord, OpenAPI.
- **Non-régression** : scénarios B1–B5, C1–C4, étapes 16–19 rejoués ; `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`,
  `db:migration --check` (aucune migration attendue), build de production dans une copie isolée.
- **Interface** : lecture et déplacement dans la vidéo (requêtes 206 observées), axe fr/en × clair/sombre, clavier,
  largeur mobile.

## 16. Risques et points ouverts

- **Compatibilité de lecture** non garantie sans transcodage (HEVC, AV1 selon le matériel) : signalée, pas résolue en D1.
- **Durée et recherche** dans les WebM de `MediaRecorder` (pas de durée ni d'index) : lecture correcte, barre de
  progression imprécise — signalé.
- **`requestTimeout` réglé via la socket** : dépend d'un détail d'implémentation de Node (propriété relue à chaque
  contrôle) ; à vérifier sous Node 24 et à revoir avec Nitro 3 / h3 2.
- **Bande passante** : servir de la vidéo depuis le processus Node consomme connexions et débit ; en production, un CDN
  (ou un mandataire avec cache) devant `NUXT_MEDIA_PUBLIC_URL` est fortement recommandé (documenté).
- **S3 réel** toujours non testé (seulement `s3rver`) : `Range` sur de gros objets à vérifier chez l'utilisateur.
- **MySQL/MariaDB** : inchangé (aucune migration en D1).

---

# D2 — Préparation des vidéos, image d'affiche, sous-titres (VALIDÉE, FAITE le 2026-10-06)

> Proposée le 2026-10-05 à la demande de l'utilisateur (« on peut continuer sur D2 ») ; **validée le même jour** avec
> le retrait des métadonnées de l'appareil en plus de celles du lieu (§ 18.3).
> Toujours **sans ffmpeg, sans file ni tâche de fond** : seulement des lectures d'en-têtes, une copie déjà existante
> réordonnée, et des calculs faits dans le navigateur de l'administrateur.

## 17. Résumé de D2 en 10 points

1. **Préparation à l'envoi** des MP4/MOV : index (`moov`) placé **en tête** (« faststart »), **lieu de tournage et
   métadonnées de l'appareil retirés**, sans réencodage, **pendant la copie vers le stockage qui existe déjà** (aucun passage supplémentaire sur le
   fichier).
2. La sortie est **vérifiée avant d'être écrite** (réanalyse + comparaison d'octets) ; au moindre doute, le fichier est
   stocké tel qu'envoyé. Désactivable (`NUXT_MEDIA_VIDEO_PREPARE`).
3. Vidéos déjà envoyées (dont votre `v1.mp4`, index en fin de fichier) : action **« Optimiser »** dans la fiche
   (nouvelle version, comme un remplacement).
4. **Image d'affiche** : une image associée à la vidéo, **capturée dans le navigateur** au moment de l'envoi (première
   image significative) ou choisie dans la fiche (image affichée par le lecteur, ou fichier envoyé).
5. L'affiche devient la **source des dérivés** de la vidéo : vignette dans la médiathèque, `previewUrl`, préréglages,
   transformations, point d'intérêt — exactement comme une image. Attribut `poster` de `<video>`.
6. **Sous-titres et pistes de texte** (WebVTT, `<track>`) : sous-titres, sous-titres pour sourds et malentendants,
   descriptions, chapitres ; plusieurs langues ; fichiers **VTT ou SRT** (converti), vérifiés puis réécrits proprement.
7. Pistes servies par `/m/<id>/v<n>/tracks/<piste>.vtt` avec les mêmes règles que les fichiers (cache, signatures,
   CORS, corbeille).
8. **Durée des WebM** enregistrés par les navigateurs (aujourd'hui « inconnue ») : estimée en lisant la fin du fichier.
9. API v1 : champs **ajoutés** à `Media` (`poster`, `textTracks`) et nouvelles routes (affiche, pistes) ; rien de
   supprimé ni de renommé.
10. **Migration** de base (colonnes d'affiche sur `Media`, table `MediaTextTrack`). Livraison : étape 21 de
    `setup.md`, en trois parties testées l'une après l'autre (préparation, affiche, pistes).

## 18. Préparation à l'envoi : index en tête, lieu et appareil (DD15 à DD17)

### 18.1 Pourquoi

- **Index en fin de fichier** (`faststart: false`, cas de votre `v1.mp4` : `ftyp`, `uuid`, `mdat`, puis `moov`) : le
  lecteur doit d'abord aller chercher la fin du fichier avant de pouvoir afficher la première image (requêtes et
  allers-retours supplémentaires, sensibles sur mobile), et les outils qui ne font pas de requêtes partielles (aperçus
  des réseaux sociaux, certains lecteurs) téléchargent tout le fichier. C'est le cas de beaucoup d'exports (logiciels de
  montage, captures d'écran, caméras).
- **Lieu de tournage** (DD11) : les vidéos de téléphone l'enregistrent ; un média public le diffuse à tout le monde.
  D1 le signale seulement.

### 18.2 Fonctionnement : un seul passage

Aujourd'hui, `storeOriginal` copie le fichier temporaire vers le stockage. Pour une vidéo MP4/MOV à préparer, cette
copie devient une **suite de morceaux** :

```
entrée : [ftyp][uuid][mdat ……………………………………][moov]
sortie : [ftyp][uuid][moov′][mdat ……………………………………]
```

- `moov′` = `moov` lu en mémoire (seule partie lue en plus : en général moins de 1 % du fichier, **64 Mio au plus**),
  métadonnées de lieu et d'appareil retirées, **décalages des échantillons** (`stco`/`co64`) recalculés : chaque boîte de premier niveau
  garde son contenu, seule sa position change, et chaque décalage est déplacé d'autant. Le plafond de 2 Gio (DD4)
  garantit que les décalages tiennent toujours dans `stco` (32 bits).
- Taille de sortie connue d'avance (≤ taille envoyée) : `PutObject` S3 inchangé ; SHA-256 calculé au fil de l'écriture.
- Fichier déjà en tête et sans métadonnées à retirer, MP4 **fragmenté** (enregistrements `MediaRecorder`, index déjà en tête), WebM : **aucune
  modification**, copie identique à aujourd'hui.

### 18.3 Ce qui est retiré : lieu de tournage et appareil

Proposé : le lieu seulement. **Validé : le lieu et les métadonnées de l'appareil** (marque, modèle, logiciel et version
du système, réglages de la caméra, décalage horaire, identifiants propres aux fabricants). Chaque fabricant a ses
propres boîtes (Samsung `smta`, `cami`, `SDLN` ; Apple clés `com.apple.quicktime.*` ; Windows `Xtra` et une boîte `uuid`
portant la version du système ; Canon `CNCV`, `CNMN` ; GoPro `GPMF`…) : une liste de boîtes à retirer en oublierait
toujours. La règle est donc une **liste de ce qui est conservé** ; tout le reste des métadonnées descriptives est retiré.

| Emplacement | Conservé | Retiré (exemples) |
| --- | --- | --- |
| Premier niveau du fichier | `ftyp`, `moov`, `mdat` | `uuid` (XMP, version de Windows…), `free`/`skip`/`wide` (bourrage), toute autre boîte |
| `udta` (film et pistes) | `name`, `kind`, `tsel` (noms et rôles des pistes), `chpl` (chapitres), titre, description, commentaire, droits d'auteur (`©nam`, `©des`, `©cmt`, `cprt`, `©cpy`, `titl`, `dscp`) | `©xyz`, `loci`, `©mak`, `©mod`, `©swr`, `©day`, `auth`, `XMP_`, `Xtra`, `smta`, `cami`, `SDLN`… |
| `meta` (clés QuickTime `mdta`) | titre, description, commentaire, droits d'auteur (`com.apple.quicktime.title`…) | lieu, marque, modèle, logiciel, date de création, `com.android.*`, `com.samsung.*`… (clés retirées de `keys`, éléments de `ilst` renumérotés) |
| `meta` (liste iTunes `ilst`) | `©nam`, `desc`, `©des`, `ldes`, `©cmt`, `cprt` | `©xyz`, `©too` (logiciel), tout le reste |
| `uuid` dans `moov` ou une piste | — | retiré |

- Une boîte `meta` ou `udta` vide après filtrage est retirée.
- Restent seulement les **informations nécessaires à la lecture** (pistes, codecs, rotation, durée) et les **dates
  techniques des en-têtes** (`mvhd`, `tkhd`, `mdhd`, en temps universel, sans décalage horaire). Le nom du gestionnaire de
  piste (`hdlr`, ex. « VideoHandle ») et celui du codeur dans la description des échantillons sont conservés (structure).
- La **détection** (`hasLocation`) couvre aussi le XMP.
- **Non couvert** (documenté) : positions ou informations enregistrées **dans les données** d'une piste de
  métadonnées (GoPro `gpmd`, `camm`, drones DJI, caméras embarquées, piste `mebx` des iPhone) : ni détectées ni retirées
  sans ffmpeg (D3 : ne garder que l'image et le son). WebM : non modifié (seuls `MuxingApp`/`WritingApp` y désignent le
  navigateur ou le logiciel).

### 18.4 Garde-fous et vérification

- **Préparation sautée** (fichier stocké tel quel, comme en D1) si : MP4 fragmenté, plusieurs `moov`, `moov` > 64 Mio,
  un décalage hors d'une boîte `mdat`, décalages absolus ailleurs (`saio` des fichiers chiffrés), données dans un autre
  fichier (`dref` non autonome).
- **Vérification de la sortie avant toute écriture** : la sortie (virtuelle : en-têtes en mémoire + plages du fichier
  temporaire) est **réanalysée par le lecteur de D1** — mêmes dimensions, durée, codecs et pistes ; index en tête ; plus
  de lieu — et, pour chaque piste, les premiers octets du premier et du dernier bloc d'échantillons sont **comparés**
  entre l'ancienne et la nouvelle position (quelques Kio lus). Un écart → fichier stocké tel qu'envoyé, journal serveur,
  l'avertissement reste dans la fiche.
- Préparer un fichier déjà préparé ne change rien (opération idempotente, testée).

### 18.5 Essais sur de vrais fichiers (2026-10-05, prototype hors du projet)

Prototype (`prepare-proto.mjs`, dossier temporaire de la session) appliqué à des **copies** des deux vidéos envoyées par
l'utilisateur (originaux jamais modifiés) :

| Fichier | Avant | Après |
| --- | --- | --- |
| Téléphone Samsung Galaxy S25 Ultra (projet « My Phone ») : HEVC 1080×1920 (rotation 90°), AAC, 14,1 s, 16,8 Mo, `co64` | `ftyp mdat moov`, lieu dans `udta/©xyz` | `ftyp moov mdat`, `©xyz` retiré (30 octets de moins), 29 blocs retrouvés à leur nouvelle place |
| `v1.mp4` (bibliothèque) : H.264 + AAC, 1,6 s | `ftyp uuid mdat moov` | `ftyp uuid moov mdat`, 12 blocs |

- Lecteur de D1 sur les sorties : mêmes dimensions, durée, codecs ; `faststart: true` ; `hasLocation: false`. `mdat`
  identique octet pour octet ; aucune coordonnée ISO 6709 restante dans le fichier ; second passage sans effet.
- Navigateur intégré (Chromium 152, décodage HEVC matériel sur ce poste) : **images décodées identiques** au pixel près
  (6 instants pour le téléphone, 5 pour `v1.mp4`).
- Temps jusqu'à la première image (serveur de test, latence et débit simulés, médiane de 5 essais) :

  | Réseau | Original (3 requêtes) | Préparé (1 requête) |
  | --- | --- | --- |
  | latence 300 ms, 50 Mbit/s | métadonnées 1 020 ms, image 1 181 ms | métadonnées 516 ms, image 881 ms |
  | latence 150 ms, 8 Mbit/s (3 essais) | image 990 ms | image 744 ms |
  | latence 40 ms, 20 Mbit/s | image 392 ms | image 345 ms |
  | local, sans limite | image 213 ms | image 282 ms |

  Le gain vient des allers-retours évités : net dès que la latence est sensible (mobile, serveur lointain), nul sur un
  réseau local. Les outils qui ne font pas de requêtes partielles téléchargent en plus tout le fichier quand l'index est
  à la fin.
- Restaient dans le fichier du téléphone avec la règle proposée (lieu seulement) : modèle de l'appareil (`auth`, `smta`),
  réglages de la caméra (`cami`), version d'Android, décalage horaire (`com.samsung.android.utc_offset`) — d'où l'ajout
  de l'utilisateur à la validation (§ 18.3). `v1.mp4` porte la version de Windows (boîte `uuid` de premier niveau) et une
  boîte `Xtra` (propriétés Windows).
- **Capture d'affiche** (§ 19.3) sur la vidéo du téléphone servie par `/m/` depuis un autre domaine : 1080×1920 à 1,41 s
  (10 % de la durée), JPEG 183 Ko, environ 1,4 s ; sans `crossorigin="anonymous"`, `<canvas>` inutilisable (erreur de
  sécurité), avec : correct.

### 18.6 Empreinte, réglage, vidéos existantes

- **Empreinte** (`checksum`, affichée dans la fiche, ETag de `/m/`) = SHA-256 du **fichier stocké et servi** ; `size`
  = sa taille. `metadata.prepared` liste les opérations faites (`faststart`, `metadata`) : la fiche affiche « Optimisée
  pour la lecture en ligne » et « Métadonnées d'origine retirées (lieu, appareil) ».
- `NUXT_MEDIA_VIDEO_PREPARE` : `faststart,metadata` par défaut ; `faststart` seul conserve les métadonnées ; `metadata`
  seul laisse l'index à sa place ; `none` désactive.
- **Action « Optimiser »** (fiche, avec les avertissements « démarrage lent » et « lieu de tournage ») :
  `POST /api/admin/media/:id/prepare` relit le fichier stocké et le fait passer par le chemin d'un **remplacement**
  (nouvelle version, anciennes URL redirigées). Mêmes droits que le remplacement. Pas d'équivalent dans l'API v1 (un
  `PUT …/file` avec le même fichier produit le même résultat).

## 19. Image d'affiche (DD18, DD19)

### 19.1 Modèle et stockage

- Colonnes de `Media` : `posterKey String? @unique`, `posterWidth Int?`, `posterHeight Int?`, `posterSize Int?`,
  `posterTime Float?` (instant capturé dans la vidéo ; `null` = image envoyée). L'affiche fait partie du média, comme
  le point d'intérêt : pas de jointure pour la diffusion ni pour les listes.
- Fichier : `variants/<média>/poster-<aléa>.jpg` (supprimé avec les dérivés à la purge).
- **Normalisée à la réception** (file des traitements, 503 si pleine) : types d'image acceptés (JPEG, PNG, WebP, AVIF,
  GIF → première image), limite des images (25 Mio), orientation appliquée, **métadonnées retirées** (EXIF/GPS d'une
  photo utilisée comme affiche), 3840 px au plus, **JPEG** qualité 90.
- Réservée aux vidéos (422 `KIND_MISMATCH` sinon).

### 19.2 Diffusion et versions

- L'affiche est la **source des dérivés de la vidéo** : `previewUrl` (aperçu WebP 480 px : cartes de la médiathèque,
  API), préréglages, transformations libres, `urlTemplate`, liens signés, **point d'intérêt** — le code des images, avec
  une autre source. Sans affiche : comme en D1 (`previewUrl` null, dérivés en 404).
- Attribut `poster` : préréglage intégré `full` en JPEG (`/m/<id>/v<n>/full/<nom>.jpg`), compatible partout (balises
  `og:image` comprises) ; les autres formats et tailles par `urlTemplate`.
- **Versions** : la **première** affiche ne change pas la version (aucun dérivé n'existait) ; la **remplacer** ou la
  **retirer** crée une nouvelle version, comme le point d'intérêt (CD8) — sinon un cache servirait l'ancienne image à
  la même URL. Un remplacement du fichier vidéo **garde** l'affiche et les pistes.
- Duplication : affiche (et pistes) copiées. Déplacement, corbeille, restauration : rien de particulier.

### 19.3 Capture dans le navigateur

- **À l'envoi** (formulaire de l'administration) : pendant l'envoi, le navigateur ouvre le fichier local dans un
  `<video muted>` caché (rien n'est envoyé pour cela), se place à 10 % de la durée (5 s au plus ; si l'image est presque
  noire, essaie un peu plus loin), dessine l'image sur un `<canvas>` à sa taille réelle (3840 px au plus) et l'envoie
  comme affiche **après** la création du média (`PUT …/poster` avec `time`). Aucun calcul serveur autre que la
  normalisation.
- Codec que le navigateur ne sait pas décoder (HEVC sur certains systèmes, ProRes…) : pas d'affiche, carte avec l'icône
  comme en D1 ; affiche ajoutable ensuite (image envoyée), ou côté serveur en D3.
- **Dans la fiche** : section « Image d'affiche » : aperçu, « Utiliser l'image affichée » (image courante du lecteur,
  mis en pause à l'endroit voulu), « Envoyer une image… », « Retirer » (confirmation). Le lecteur porte
  `crossorigin="anonymous"` quand les fichiers sont servis depuis un autre domaine (`NUXT_MEDIA_PUBLIC_URL`), sinon le
  `<canvas>` serait inutilisable.
- **Applications clientes** (API) : même principe, extrait JavaScript dans la documentation OpenAPI (section « Vidéos »).

## 20. Sous-titres et pistes de texte (DD20, DD21)

### 20.1 Modèle

```prisma
enum TextTrackKind { SUBTITLES CAPTIONS DESCRIPTIONS CHAPTERS }

model MediaTextTrack {
  id           String        @id @default(cuid())
  mediaId      String
  kind         TextTrackKind
  language     String        // BCP 47 canonique (fr, en-GB, pt-BR…)
  label        String        // 100 caractères au plus
  isDefault    Boolean       @default(false)
  storageKey   String        @unique   // variants/<média>/track-<aléa>.vtt
  size         Int
  checksum     String
  cueCount     Int
  sourceFormat String        // vtt | srt
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  media        Media         @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@index([mediaId])
}
```

- **Vidéos seulement**, **20 pistes** au plus par vidéo, **1 Mio** par fichier.
- **Fichier immuable** : le remplacer crée une nouvelle piste (l'interface garde type, langue, libellé et « par défaut »
  et retire l'ancienne dans la même opération) ; type, langue, libellé et « par défaut » sont modifiables sans changer le
  fichier ni son URL.
- **Une piste par défaut au plus par groupe** (sous-titres et sous-titres SME ensemble ; descriptions ; chapitres), comme
  l'exige HTML : en désigner une retire l'indication des autres.
- Toute modification met à jour `Media.updatedAt` (ETag de l'API) et passe par `mediaChanged`. Pas d'entrée de journal
  (comme le titre ou le texte alternatif).

### 20.2 Formats acceptés et vérification

- **WebVTT** (`.vtt`) et **SubRip** (`.srt`, converti) ; encodage **UTF-8** (avec ou sans BOM), UTF-16 avec BOM, sinon
  **Windows-1252** (fréquent pour les anciens SRT français).
- Le fichier est **analysé puis réécrit** en WebVTT normalisé (UTF-8, fins de ligne LF, horodatages complets) :
  répliques (identifiant, temps, réglages `position`/`line`/`size`/`align`/`vertical`/`region`, texte avec les balises
  WebVTT `c i b u v lang ruby rt` et horodatages internes), blocs `REGION` et `STYLE` conservés, commentaires `NOTE`
  retirés. SRT : `<i> <b> <u>` conservés, `<font>` et balises ASS (`{\an8}`…) retirées.
- Refus **422 `INVALID_TEXT_TRACK`** avec le numéro de ligne : en-tête absent, temps illisibles ou fin ≤ début, fichier
  vide ; au plus 20 000 répliques et 2 000 caractères par réplique.
- Le texte des répliques n'est jamais interprété comme du HTML (analyseur WebVTT des navigateurs ; affiché comme texte
  dans l'administration).

### 20.3 Diffusion

- `/m/<id>/v<n>/tracks/<piste>.vtt`, `Content-Type: text/vtt; charset=utf-8`, mêmes règles que l'original : média
  public = cache immuable ; privé = lien signé (nouveau droit `track:<piste>`, couvert par le droit `admin`, pas par
  `derived`) ou Bearer ; corbeille → 404 ; ancienne version → 302. `tracks` devient un nom de préréglage réservé (aucun
  préréglage ne porte ce nom aujourd'hui, vérifié).
- Domaine différent du site (CDN, site client) : `<track>` exige `crossorigin="anonymous"` sur `<video>` ; `/m/` envoie
  déjà `Access-Control-Allow-Origin: *`. L'extrait HTML l'ajoute dès qu'il y a une piste.

### 20.4 Interface

- Fiche, section « Sous-titres et pistes de texte » : liste (langue, libellé, type, par défaut, nombre de répliques) ;
  ajouter (fichier `.vtt`/`.srt`, type, langue avec noms via `Intl.DisplayNames` et saisie d'un code, libellé
  pré-rempli avec le nom de la langue dans cette langue — « Français », « English » —, par défaut) ; modifier ;
  remplacer le fichier ; télécharger ; supprimer (confirmation).
- Lecteur de la fiche : un `<track>` par piste → bouton des sous-titres des commandes natives. L'audit axe
  `video-caption` (« incomplet » en D1) est résolu quand une piste `captions` existe ; un avertissement propose
  d'ajouter des sous-titres quand la vidéo a du son et aucune piste (WCAG 1.2.2).
- Extrait `<video>` : `poster`, `crossorigin` si besoin, une balise `<track>` par piste.

## 21. Durée des WebM sans durée (DD23)

- Les WebM de `MediaRecorder` n'annoncent pas de durée. Le serveur lit la **fin du fichier** (4 Mio au plus), y
  retrouve le dernier `Cluster` (recherche de l'identifiant puis analyse cohérente jusqu'à la fin) et estime l'instant
  de fin : `duration` rempli, `metadata.durationEstimated: true`. Le fichier n'est pas modifié.
- Limite : le lecteur du navigateur continue de découvrir la durée en lisant (pas d'index dans le fichier). Réparer le
  fichier (durée + index des repères) exige de le lire en entier : D3 (ffmpeg, copie sans réencodage).

## 22. Contrats (DD22)

**Administration** (ajouts) :
- `MediaSummary` : `previewUrl` rempli pour une vidéo avec affiche ; `poster: { width, height, time } | null`.
- `MediaDetail` : `posterUrl` (JPEG `full`, lien signé « admin » si privé) ; `textTracks[]` (`id`, `kind`, `language`,
  `label`, `default`, `size`, `cueCount`, `url`, `createdAt`).
- Routes : `PUT|DELETE /api/admin/media/:id/poster`, `POST /api/admin/media/:id/tracks`,
  `PATCH|DELETE /api/admin/media/:id/tracks/:trackId`, `POST /api/admin/media/:id/prepare`. Droits = ceux de la
  modification du média (bibliothèque : ADMIN ; projets : selon le rôle).

**API v1** (ajouts seulement) :
- `Media` : `poster: { url, width, height, time } | null` (URL JPEG `full`, signée si privé) ; `textTracks: TextTrack[]`
  (`[]` pour une image ; `url` signée si privé). Pour une vidéo avec affiche, `previewUrl` et `urlTemplate` désignent
  des images tirées de l'affiche.
- `PUT|DELETE …/media/{mediaId}/poster` (multipart `file`, champ `time` facultatif) → `Media` ;
  `GET|POST …/media/{mediaId}/tracks`, `PATCH|DELETE …/media/{mediaId}/tracks/{trackId}`. Portée `media:write` (lecture :
  `media:read`), identifiants secret / personnel / délégué comme `PATCH` ; affiche et pistes ne comptent pas dans
  `maxFiles` d'un jeton délégué et ne sont pas soumises à ses `types`.
- `signed-url` et le lot `signed-urls` : nouvelle cible `track` (+ `trackId`), pour des liens de 7 jours au plus comme
  pour le fichier.
- Erreurs : `KIND_MISMATCH` (422, pas une vidéo), `TRACK_NOT_FOUND` (404), `TRACK_LIMIT_REACHED` (409),
  `INVALID_TEXT_TRACK` (422, `detail` avec la ligne). OpenAPI fr/en, section « Vidéos » complétée.

## 23. Performance (DD24)

| Opération | Coût | Où |
| --- | --- | --- |
| Préparation | aucun passage supplémentaire (copie existante réordonnée) + lecture de `moov` (quelques Mio, 64 Mio au plus) + SHA-256 de la sortie (≈ 1 s de calcul par Gio, réparti par blocs de 64 Kio, comme l'empreinte de l'envoi mesurée en DD14) | requête d'envoi |
| Vérification | réanalyse d'en-têtes en mémoire + quelques Kio comparés | requête d'envoi |
| Affiche | capture dans le navigateur ; côté serveur un encodage JPEG par affiche + aperçu pré-généré, comme pour une image | file des traitements |
| Pistes | texte ≤ 1 Mio analysé en quelques millisecondes | requête |
| Durée WebM | lecture de 4 Mio au plus | requête d'envoi |

Toujours ni ffmpeg, ni nouvelle file, ni tâche de fond. Les fichiers qui n'ont besoin de rien ne coûtent rien de plus
qu'en D1.

## 24. Décisions à valider (D2)

| # | Décision proposée | Alternative |
| --- | --- | --- |
| DD15 | **Préparation automatique** des MP4/MOV à l'envoi : index en tête + retrait du lieu **et de l'appareil (ajout de l'utilisateur, liste de ce qui est conservé)**, en un passage, sortie vérifiée sinon fichier gardé tel quel ; `NUXT_MEDIA_VIDEO_PREPARE` (défaut `faststart,metadata`) | lieu conservé par défaut ; choix à chaque envoi ; garder aussi le fichier d'origine (double stockage) |
| DD16 | Empreinte et taille = **fichier stocké** ; opérations listées dans `metadata.prepared` | empreinte du fichier envoyé |
| DD17 | Action **« Optimiser »** pour les vidéos déjà envoyées (nouvelle version, administration seulement) | remplacer le fichier à la main |
| DD18 | **Affiche** = colonnes de `Media`, normalisée en JPEG (orientation, métadonnées retirées, 3840 px), **source des dérivés** de la vidéo ; 1ʳᵉ affiche sans nouvelle version, remplacement ou retrait = nouvelle version | affiche = média image distinct lié (visible ou à cacher dans toutes les listes) ; révision d'affiche séparée dans l'URL |
| DD19 | Affiche **capturée dans le navigateur** (envoi et fiche) ou image envoyée ; aucune extraction serveur avant D3 | attendre D3 (ffmpeg) |
| DD20 | **Pistes WebVTT** (4 types, BCP 47, par défaut par groupe), VTT et SRT, UTF-8 / UTF-16 / Windows-1252, **analysées et réécrites**, 1 Mio et 20 pistes, fichier immuable | stocker tel quel ; VTT seulement |
| DD21 | Pistes servies par `/m/<id>/v<n>/tracks/<piste>.vtt`, mêmes règles de cache et d'accès, droit signé `track:<piste>`, nom `tracks` réservé | URL sans version |
| DD22 | API v1 : `poster` et `textTracks` **ajoutés** à `Media`, routes affiche et pistes (`media:write`, jetons délégués compris hors quota), cible signée `track` | objet `video {}` / `sources[]` dès maintenant (prévu en D3) |
| DD23 | Durée des WebM **estimée** par la fin du fichier (4 Mio au plus) ; réparation du fichier en D3 | rien avant D3 |
| DD24 | Coûts du § 23 ; toujours ni ffmpeg ni tâche de fond ; étape 21 en trois parties (préparation, affiche, pistes) | — |

## 25. Plan de vérification de D2

- **Vitest** :
  - préparation sur des fichiers **synthétiques** : `moov` en fin, plusieurs `mdat`, `co64`, `wide`/`free`, lieu dans
    `udta`, `meta`/`keys`/`ilst` et XMP ;
  - cas laissés intacts : fichiers fragmentés, chiffrés, à références externes ;
  - idempotence, comparaison des octets des échantillons avant/après, fichiers hostiles ;
  - VTT/SRT : encodages, BOM, CRLF, balises, balises ASS, temps invalides, limites, normalisation stable ;
  - durée WebM sur les fichiers `MediaRecorder` ; chemins `/tracks/` ; signatures `track:`.
- **Vrais fichiers** :
  - votre `v1.mp4` (index en fin), **copié en lecture seule** dans le dossier temporaire de la session, jamais modifié ni
    ajouté au dépôt : préparation, lecture dans le navigateur intégré, **images comparées avant/après** (`<canvas>`) ;
  - fichiers `MediaRecorder` du dépôt ;
  - une vidéo de téléphone avec lieu **si vous pouvez en fournir une**.
- **Scénario HTTP** `d2-test.mjs` :
  - préparation : admin et v1, empreinte et taille, action `prepare` ;
  - affiche : admin, v1, jeton délégué ; règles de version ; aperçu, `full`, transformations ; privé signé, corbeille ;
  - pistes : création, modification, suppression, limites, erreurs ; diffusion publique, signée et Bearer ; CORS ; 302 ;
    404 en corbeille ;
  - duplication (affiche et pistes copiées), purge (fichiers supprimés), OpenAPI.
- **Non-régression** :
  - scénarios précédents, et `video-test.mjs` adapté (empreinte et taille des MP4 préparés) ;
  - `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`, `db:migration --check` ;
  - build de production dans une copie isolée.
- **Interface** :
  - capture à l'envoi, section affiche, section pistes, lecteur avec sous-titres ;
  - axe fr/en × clair/sombre, clavier, 375 px.

## 26. Risques et limites de D2

- **Fichier envoyé non conservé tel quel** quand il est préparé : une erreur du réécriveur abîmerait le seul exemplaire.
  Parades : vérification avant écriture, repli sur le fichier intact, tests sur fichiers synthétiques et réels,
  désactivation par `NUXT_MEDIA_VIDEO_PREPARE=none`.
- Lieu dans les **données** des pistes de métadonnées (GoPro, drones, caméras embarquées) : ni détecté ni retiré (D3).
- Capture d'affiche impossible quand le navigateur ne décode pas le codec : image à envoyer, ou D3.
- Une piste ou une affiche retirée d'un média public reste dans les caches (CDN) jusqu'à leur échéance, comme tout
  fichier public déjà diffusé.
- Migration sur les trois bases (SQLite, PostgreSQL, MySQL) : colonnes ajoutées sans valeur par défaut obligatoire,
  nouvelle table.

## 27. Hors D2 (pour mémoire)

Extraction d'affiches et de vignettes côté serveur, réparation des WebM, transcodage, formats refusés en D1 (D3) ;
vignettes de survol de la barre de lecture (`thumbnails` VTT), HLS (D4) ; sous-titres automatiques (reconnaissance de la
parole) ; retrait des autres métadonnées (date, appareil) ; retrait du GPS des **originaux d'images** (même logique,
proposable ensuite) ; envois reprenables, fichiers > 2 Gio ; composant `<SmVideo>`.

---

# D3 — Traitements vidéo avec ffmpeg, hors du processus web (PROPOSÉE le 2026-10-06, en attente de validation)

> Proposée le 2026-10-06 à la suite de D2. Rien n'est codé avant validation. Applique les règles de performance de DD12
> (§ 12) : aucun traitement lourd dans le chemin d'une requête, processus séparé, file persistante, **désactivé par
> défaut**. Une installation sans ffmpeg se comporte exactement comme après D2.

## 28. Résumé de D3 en 10 points

1. **ffmpeg du système**, jamais embarqué ni en WASM, toujours lancé comme **processus enfant** : le calcul ne passe
   jamais par la boucle d'événements de Node. Détecté au démarrage (version ≥ 6, encodeurs présents).
2. **Trois modes** : `off` (défaut, comportement de D2), `embedded` (le serveur web exécute les tâches, ffmpeg en
   **priorité la plus basse** — mesuré, § 29.3), `external` (un ou plusieurs **processus de travail** lancés à part, même
   build, rôle `worker`).
3. **File persistante en base** (`MediaJob`) : une tâche par vidéo et par version, reprise après un arrêt (bail
   renouvelé), essais limités, priorité. Statut résumé sur le média (`processingState`) : en attente, en cours, prête,
   en échec.
4. Règle de base : **une réécriture sans perte remplace l'original** (nouvelle version, comme « Optimiser » en D2) ;
   **un réencodage produit un rendu à côté de l'original**, qui reste téléchargeable tel qu'envoyé.
5. **Affiche côté serveur** quand aucune n'existe (envois par l'API, codecs que le navigateur ne décode pas) ; jamais
   d'écrasement d'une affiche choisie. Les vignettes de la médiathèque en découlent (dérivés de l'affiche, déjà en place).
6. **Rendu compatible H.264/AAC** (MP4, ≤ 1080p, « faststart ») produit **seulement quand il sert** : codec à
   compatibilité variable (HEVC, AV1, ProRes…), format converti, définition ou débit trop élevés. HDR ramené en SDR.
   AV1 en option, désactivé par défaut.
7. **Réparation des WebM** sans durée ni index (copie sans réencodage) et **retrait des pistes de métadonnées**
   (positions GPS GoPro, drones, `mebx` des iPhone) : copie sans réencodage puis filtre de D2 (liste de ce qui est conservé).
8. **Formats refusés en D1 acceptés** une fois convertis (MKV, AVI, 3GP, MPEG-TS/M2TS, OGV, WMV) — seulement si le
   traitement est actif ; l'original est conservé pour le téléchargement, la lecture passe par le rendu.
9. **Contrat `sources[]`** dans l'API (liste ordonnée prête pour `<source type="…">`) et objet `processing` : champs
   **ajoutés**, rien de retiré ni renommé.
10. **Entrées hostiles** : format d'entrée imposé (jamais deviné par ffmpeg), protocoles limités au fichier, délai,
    mémoire, fils et priorité bornés. Livraison : étape 22 de `setup.md`, en trois parties (§ 39, DD36).

## 29. Environnement vérifié et mesures (2026-10-06, machine du nuage)

### 29.1 Environnement

- **ffmpeg 6.1.1** (Ubuntu) présent : `libx264`, `libx265`, `libsvtav1`, `libaom`, `libvpx`, `aac`, `libopus` ;
  décodeurs HEVC, ProRes, AV1 (`libdav1d`) ; filtres `zscale`, `tonemap`, `thumbnail`, `blackframe`.
- **Chromium** présent (`/opt/pw-browsers`) pour les vérifications d'interface.
- **pnpm 12.4.2** : `pnpm install` et `pnpm typecheck` corrects sous Linux. **Node 22.22** installé alors que le projet
  exige ≥ 24 : un test échoue (`text-track.test.ts`, Windows-1252), car le `TextDecoder('windows-1252')` de Node 22 décode
  en Latin-1 (0x96 → U+0096 au lieu de « – »). Avec Node 24.21 (téléchargé dans le dossier temporaire de la session) :
  **281 tests verts**. Rien à corriger dans le projet (`engines` le dit déjà).
- **4 processeurs virtuels, 15 Gio** : chiffres ci-dessous à lire comme des ordres de grandeur.

### 29.2 Coût des opérations (source HEVC 1080p 30 i/s, 20 s, AAC, 25,6 Mo, mire animée bruitée)

| Opération | Temps réel | Temps processeur | Mémoire max | Sortie |
| --- | --- | --- | --- | --- |
| Affiche (1 image à 2 s) | 0,41 s | 1,1 s | 150 Mo | JPEG 104 Ko |
| 10 vignettes réparties (décodage complet) | 2,9 s | 9,0 s | 128 Mo | 52 Ko |
| Copie sans réencodage (remux, `faststart`) | 0,05 s | 0,07 s | 57 Mo | 25,6 Mo |
| **H.264 1080p `veryfast` CRF 23 + AAC** | **10,7 s** | 34,7 s | 407 Mo | 12,8 Mo |
| H.264 1080p `medium` CRF 23 | 18,1 s | 65,9 s | 637 Mo | 15,1 Mo |
| H.264 720p `veryfast` | 6,1 s | 20,3 s | 263 Mo | 3,2 Mo |
| AV1 1080p SVT-AV1 préréglage 10 CRF 35 + Opus | 15,5 s | 53,4 s | 748 Mo | 12,1 Mo |

- Un rendu H.264 1080p coûte environ **1,7 s de processeur par seconde de vidéo** (≈ 0,5 × la durée sur 4 cœurs) :
  une vidéo de téléphone d'une minute ≈ 30 s, une vidéo d'une heure ≈ 30 min. D'où : jamais dans une requête, une tâche
  à la fois par défaut.
- Mémoire : 0,4 à 0,75 Gio par encodage 1080p (davantage en 4K) → concurrence 1 par défaut.
- Les tailles de sortie ne sont **pas représentatives** (mire bruitée) ; à remesurer sur de vraies vidéos (§ 40).
- **Réparation WebM** sur les deux enregistrements `MediaRecorder` du dépôt : durée « N/A » → 1,961 s et 1,987 s, index
  des repères (`Cues`) absent → présent, en quelques millisecondes.

### 29.3 Effet d'un encodage sur le serveur web de la même machine

Banc `latency.mjs` (dossier temporaire de la session) : serveur HTTP Node (réponse de 16 Kio + sérialisation JSON),
8 clients en continu pendant 8 s, encodage H.264 1080p en boucle à côté. Un seul passage :

| Situation | Réponses/s | p50 | p99 | Retard max de la boucle |
| --- | --- | --- | --- | --- |
| Sans ffmpeg | 4 695 | 1,49 ms | 4,08 ms | 14,0 ms |
| ffmpeg 4 fils, priorité normale | 3 288 (−30 %) | 1,55 ms | **11,80 ms** | **68,0 ms** |
| ffmpeg 4 fils, `nice 19` | 5 854 | 1,09 ms | 5,58 ms | 20,4 ms |
| ffmpeg 2 fils, `nice 19` | 7 020 | 0,97 ms | 2,75 ms | 15,7 ms |

- En priorité normale, ffmpeg prend des cœurs au serveur : p99 × 3, débit −30 %. En **priorité la plus basse**, l'effet
  disparaît dans le bruit de la mesure (les débits plus élevés sous charge viennent des variations de fréquence de la
  machine virtuelle, pas d'un gain réel). D'où DD26 : ffmpeg toujours lancé en priorité la plus basse
  (`os.setPriority(pid, 19)`, qui correspond sous Windows à `IDLE_PRIORITY_CLASS`), y compris en mode `external`.

## 30. Exécution : ffmpeg, modes, processus de travail (DD25, DD26)

### 30.1 ffmpeg (DD25)

- **Binaire du système** : `NUXT_FFMPEG_PATH` et `NUXT_FFPROBE_PATH` (défaut : `ffmpeg` et `ffprobe` du `PATH`).
  Pas de paquet `ffmpeg-static` ni de WASM : binaires de 70 à 80 Mo, licence GPL des builds avec x264, traçage Nitro
  + pnpm, et Smart App Control sous Windows (déjà vécu avec argon2 et oxc) ; un binaire installé par le système
  (`apt install ffmpeg`, `winget install Gyan.FFmpeg`, image Docker) se met à jour avec lui.
- **Contrôle au démarrage** du mode actif : `ffmpeg -version` (≥ 6.0), `-encoders` (`libx264` et `aac` exigés ;
  `libsvtav1` si AV1 demandé), `-filters` (`zscale` + `tonemap` pour le HDR, sinon les vidéos HDR sont converties sans
  correction de couleurs et signalées). Échec → traitement désactivé, message clair au démarrage et dans « Réglages »
  (jamais d'arrêt du serveur).
- Appels par `child_process.spawn` (jamais de shell, arguments en tableau), `-nostdin`, `-hide_banner`, sorties
  d'erreur bornées (64 Kio gardés pour le journal), progression lue par `-progress pipe:1`.

### 30.2 Modes (DD26)

| `NUXT_VIDEO_PROCESSING` | Qui exécute les tâches | Quand l'utiliser |
| --- | --- | --- |
| `off` (**défaut**) | personne ; aucune tâche créée | installation sans ffmpeg ; comportement de D2 |
| `embedded` | le serveur web lui-même (boucle de fond + ffmpeg enfant en priorité basse) | une seule machine, installation simple, développement |
| `external` | des **processus de travail** séparés ; le serveur web ne fait que créer les tâches | production chargée, machine ou conteneur dédié aux calculs |

- **Processus de travail = même build, autre rôle** : `NUXT_SERVER_ROLE=worker node .output/server/index.mjs` (ou
  `surge-media worker [--port 3001]`, qui lance la même chose). Il exécute les tâches et ne sert que `/api/health`
  (sonde des conteneurs) ; toute autre route → 404. Une seule image Docker pour les deux rôles ; aucun code serveur à
  dupliquer ni à construire autrement (le code des médias dépend des imports automatiques de Nitro, que la CLI tsdown n'a
  pas).
- **Conditions du mode `external` sur une autre machine** : base partagée (PostgreSQL ou MySQL ; SQLite seulement sur
  la même machine) et stockage partagé (S3, ou disque monté au même endroit). Vérifié au démarrage du processus de
  travail (lecture d'un fichier témoin du stockage).
- Plusieurs processus de travail possibles (la prise d'une tâche est atomique, § 31.2).
- **Arrêt propre** : ffmpeg tué (arbre de processus), tâche rendue à la file sans compter d'essai, fichiers temporaires
  supprimés.

## 31. File persistante et statut (DD27)

### 31.1 Modèle

```prisma
enum MediaJobStatus { QUEUED RUNNING DONE FAILED CANCELLED }
enum ProcessingState { PENDING PROCESSING READY FAILED }

model MediaJob {
  id          String         @id @default(cuid())
  mediaId     String
  version     Int            // version du média visée ; une nouvelle version rend la tâche caduque
  status      MediaJobStatus @default(QUEUED)
  priority    Int            @default(0)   // 0 = envoi récent ; -10 = traitement des vidéos existantes
  attempts    Int            @default(0)
  runAfter    DateTime       @default(now())  // reprise différée après un échec (30 s, 5 min, 30 min)
  lockedBy    String?        // identifiant du processus (hôte + pid + aléa)
  leaseUntil  DateTime?      // bail : 2 min, renouvelé toutes les 30 s
  step        String?        // étape en cours (probe, sanitize, poster, transcode…)
  progress    Float?         // 0–1, écrit au plus toutes les 5 s
  result      Json?          // étapes faites, sautées, avertissements
  errorCode   String?
  errorDetail String?        // 500 caractères au plus, jamais de chemin du serveur
  createdAt   DateTime       @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?
  media       Media          @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@index([status, runAfter, priority])
  @@index([mediaId])
}
```

- `Media.processingState ProcessingState?` : `null` = non concerné (image, ou traitement inactif à l'envoi). Colonne sur
  `Media` pour que les listes (cartes, API) n'aient aucune jointure à faire.
- La tâche est créée **dans la même transaction** que le média (envoi, remplacement, « Optimiser »). Au démarrage, un
  rattrapage recrée la tâche d'un média `PENDING` qui n'en a plus (cas d'une base restaurée).

### 31.2 Prise, bail, reprise

- **Prise atomique portable** (SQLite, PostgreSQL, MySQL, sans `SKIP LOCKED`) : lecture de la prochaine tâche
  (`QUEUED`, `runAfter ≤ maintenant`, priorité puis ancienneté), puis `updateMany({ where: { id, status: 'QUEUED' } })` ;
  compte = 0 → un autre processus l'a prise, on passe à la suivante.
- **Bail** : `leaseUntil` renouvelé toutes les 30 s pendant le calcul. Un bail échu (processus tué, machine perdue) →
  la tâche revient en file (`attempts + 1`). **3 essais** au plus, puis `FAILED` ; reprise différée 30 s, 5 min, 30 min.
- **Attente sans tâche** : une requête indexée toutes les 5 s par processus de travail (négligeable) ; en mode
  `embedded`, réveil immédiat à la création d'une tâche.
- **Concurrence** : `NUXT_VIDEO_CONCURRENCY` (défaut **1**, mesures du § 29.2) par processus.
- Un processus de travail actif écrit sa présence toutes les 60 s (`Setting` `videoWorker:<id>` : version de ffmpeg,
  encodeurs, concurrence, dernière activité) : « Réglages » et `/api/health` savent si quelqu'un traite la file.

### 31.3 Cycle de vie avec les actions de l'utilisateur

| Action pendant le traitement | Effet |
| --- | --- |
| Remplacement du fichier, « Optimiser » | la tâche de l'ancienne version devient caduque (`CANCELLED`, ffmpeg arrêté au prochain contrôle) ; nouvelle tâche |
| Corbeille | tâche annulée (aucun calcul pour un média en corbeille) ; restauration → nouvelle tâche |
| Purge | tâches supprimées (cascade), rendus supprimés avec les dérivés (`variants/<média>/`) |
| Duplication | rendus copiés (`CopyObject`), état copié ; pas de nouveau calcul |
| Affiche choisie par l'utilisateur | l'affiche du serveur n'est jamais enregistrée par-dessus (contrôle au moment d'écrire) |

- **Toute écriture** d'un résultat est conditionnelle : même version, pas de corbeille ; sinon le résultat est jeté et
  ses fichiers supprimés. Les écritures passent par le service médias (`mediaChanged`).
- **Caches d'un autre processus** : en mode `external`, le cache de diffusion du serveur web (60 s) ignore les
  écritures du processus de travail. Un rendu demandé mais inconnu du cache provoque **une relecture** du média en base
  avant le 404 ; la nouvelle version d'une réécriture sans perte est vue au plus 60 s plus tard (anciennes URL → 302
  ensuite), comme avec plusieurs instances aujourd'hui.

## 32. Ce que fait une tâche (DD28 à DD31)

Une tâche suit un **plan calculé par une fonction pure** (`planVideoJob(analyse, média, réglages)`, testée) ; chaque
étape est sautée quand elle ne sert à rien. Fichier source : lu directement en stockage local, copié dans un dossier
temporaire sous S3 (ffmpeg doit pouvoir se déplacer dans le fichier, `moov` en fin) ; dossier supprimé à la fin.

| Étape | Quand | Résultat |
| --- | --- | --- |
| 1. `probe` (ffprobe, JSON) | toujours | flux, pistes de données, couleur (HDR), images clés ; contrôle de cohérence avec l'analyse de D1 |
| 2. `sanitize` | pistes de métadonnées (§ 32.4) | **original remplacé** (sans perte), nouvelle version |
| 3. `repair` | WebM sans durée ou sans index | **original remplacé** (sans perte), nouvelle version |
| 4. `poster` | aucune affiche | affiche enregistrée (1ʳᵉ affiche : pas de nouvelle version, DD18) |
| 5. `transcode` | rendu utile (§ 32.2) | rendu H.264/AAC à côté de l'original |
| 6. `av1` | option activée et rendu utile | rendu AV1/Opus (WebM) à côté de l'original |
| 7. `verify` | après 2, 3, 5, 6 | réanalyse par le lecteur de D1 : durée (± 0,5 s), dimensions, codecs attendus ; sinon sortie jetée |

Les étapes 2 et 3 sont faites **en une seule copie** si les deux s'appliquent, et **avant** l'affiche (une seule
nouvelle version).

### 32.1 Règle « sans perte → original ; réencodage → rendu » (DD28)

- Une **copie sans réencodage** (mêmes images, même son) ne perd rien : elle remplace le fichier stocké, comme la
  préparation de D2 à l'envoi et « Optimiser » (même chemin : `commitNewFile`, version + 1, anciennes URL → 302,
  `metadata.prepared` complété). Sinon le fichier diffusé garderait le problème (positions GPS publiques, WebM sans
  index) et le rendu en serait une copie presque identique.
- Un **réencodage** perd de la qualité : l'original est gardé tel quel (téléchargement, archive, nouveau rendu plus tard
  avec d'autres réglages) et le rendu est stocké à côté.
- **Alternative** : réparation et nettoyage en rendus, original jamais modifié après l'envoi. Écartée : fichier d'origine
  toujours diffusé à son URL, donc positions GPS publiques.

### 32.2 Rendu compatible (DD29)

- **Produit seulement s'il sert** (`NUXT_VIDEO_RENDITION=auto`, défaut) : compatibilité `variable` (HEVC, AV1, ProRes…),
  format converti (§ 33), petit côté > 1080 px (4K des téléphones), débit moyen > 10 Mbit/s, ou HDR. Une vidéo H.264
  1080p raisonnable n'en reçoit pas : l'original reste la source unique (aucun calcul, aucun stockage en plus).
  `always` : toujours ; `never` : jamais (affiche, réparation et nettoyage seulement).
- **Réglages du rendu** : MP4 `faststart`, H.264 High, `yuv420p`, CRF 23 (`NUXT_VIDEO_CRF`), préréglage `veryfast`
  (`NUXT_VIDEO_PRESET` ; `medium` coûte 1,7 × plus, § 29.2), petit côté ≤ 1080 px sans agrandissement, cadence
  d'origine plafonnée à 60 i/s, image clé toutes les 2 s (déplacement rapide dans la lecture, futur HLS), rotation
  appliquée aux pixels (plus de matrice), AAC 128 kbit/s stéréo, 48 kHz ; vidéo sans son → sans piste son.
- **HDR** (HEVC 10 bits HLG ou PQ des iPhone et Android récents) : conversion en SDR BT.709 (`zscale` + `tonemap`),
  sinon couleurs délavées en H.264 8 bits. Filtres absents → rendu fait sans correction, avertissement dans la fiche.
- **AV1** (`NUXT_VIDEO_AV1=on`, désactivé par défaut) : WebM AV1 + Opus, proposé en premier dans `sources[]` (lecteurs
  récents), le H.264 restant le repli. Coût ≈ 1,5 × le H.264 `veryfast` et 0,75 Gio de mémoire (§ 29.2).
- **Un seul rendu H.264** en D3 : plusieurs définitions n'ont d'intérêt qu'avec le streaming adaptatif (D4, HLS).

### 32.3 Affiche côté serveur (DD30)

- Seulement si le média n'a **aucune affiche** (envoi par l'API, codec que le navigateur ne décode pas, capture
  interrompue) ; jamais d'écrasement, pas de bouton « régénérer » qui remplacerait une affiche choisie (l'utilisateur
  a déjà « Utiliser l'image affichée » et « Envoyer une image… »).
- Même règle que la capture du navigateur (§ 19.3) : 10 % de la durée, 5 s au plus ; image presque noire (`blackframe`)
  → jusqu'à 3 essais plus loin. Image extraite **depuis le rendu H.264** quand il existe (couleurs SDR déjà corrigées),
  sinon depuis l'original avec la même conversion HDR.
- Puis le chemin existant : `normalizePoster` (JPEG, ≤ 3840 px, sans métadonnées) dans la file des traitements
  d'images, `posterTime` rempli, aperçu pré-généré. **Vignettes** de la médiathèque et `previewUrl` : dérivés de
  l'affiche, déjà en place depuis D2 (rien de plus à produire).
- Vignettes de survol de la barre de lecture (planche + VTT `thumbnails`) : D4 (décodage complet : 2,9 s pour 20 s,
  § 29.2).

### 32.4 Réparation des WebM et retrait des pistes de métadonnées (DD31)

- **WebM** (enregistrements `MediaRecorder`) : copie sans réencodage par ffmpeg, qui écrit la durée et l'index des
  repères (`Cues`) ; `durationEstimated` disparaît, la barre de lecture devient exacte et le déplacement direct.
- **Pistes de métadonnées** : détectées **dès l'envoi** par le lecteur de D1 (gestionnaire `meta`, ou description
  d'échantillon `gpmd` GoPro, `camm` caméras 360°, `mebx` iPhone, `djmd`/`dbgi` DJI, `tx3g` sans rôle de sous-titre…),
  `metadata.dataTracks` → avertissement dans la fiche dès D3, même traitement inactif (« Ce fichier contient une piste
  de données de l'appareil, souvent des positions GPS »).
- Retrait : ffmpeg copie **seulement la vidéo et le son** (`-map 0:v:0 -map 0:a? -dn -c copy`), puis la sortie passe
  par la **préparation de D2** (liste de ce qui est conservé, `faststart`) : une seule règle des métadonnées, déjà
  testée. Les chapitres (`chpl`) et sous-titres intégrés ne sont pas repris (les pistes de texte de D2 les remplacent).
- **Retenue de la diffusion (choix validé)** : entre l'envoi et la fin du nettoyage, l'original contient encore la
  piste. Tant que l'étape `sanitize` est en attente ou en cours, l'original et ses rendus **ne sont servis qu'aux liens
  « admin »** (aperçu de l'administration) : toute autre requête sur `/m/` reçoit **`503` + `Retry-After: 30`**
  (`PROCESSING_PENDING`), le média reste visible et modifiable ; l'affiche et ses dérivés restent servis (ils ne
  contiennent pas la piste). En échec définitif du nettoyage, la retenue est levée et l'avertissement reste dans la
  fiche (l'utilisateur décide : rendre privé, supprimer). Traitement inactif (`off`) : avertissement seulement, comme
  en D2. Exception assumée à la règle 3 du § 12 (média utilisable pendant le traitement) au profit de la vie privée.

## 33. Formats acceptés une fois convertis (DD32)

| Format | Reconnaissance (`sniff.ts`) | Format d'entrée imposé à ffmpeg |
| --- | --- | --- |
| Matroska `.mkv` | EBML, `DocType` = `matroska` | `matroska` |
| AVI `.avi` | `RIFF` … `AVI ` | `avi` |
| 3GP / 3G2 | `ftyp` de marque `3g*` | `mov` |
| MPEG-TS / AVCHD `.ts .mts .m2ts` | octet `0x47` tous les 188 (ou 192) octets, 4 paquets vérifiés | `mpegts` |
| Ogg Theora `.ogv` | `OggS` + en-tête `\x80theora` | `ogg` |
| WMV / ASF `.wmv` | GUID d'en-tête ASF | `asf` |

- **Accepté seulement si le traitement est actif** (`embedded`, ou `external` avec un processus de travail vu dans les
  5 dernières minutes) ; sinon 415 comme aujourd'hui. FLV, MPEG-PS, RealMedia : toujours refusés (rares, surface
  d'attaque inutile).
- Ces fichiers ne sont **pas lisibles par `<video>`** : `metadata.playback` = `none`, l'original est servi en
  téléchargement (`Content-Disposition: attachment`), la fiche affiche « Conversion en cours » puis le lecteur sur le
  rendu ; dimensions et durée remplies par l'étape `probe` (inconnues avant).
- Pas de piste vidéo, flux illisible, durée nulle → tâche `FAILED` avec un code (`NO_VIDEO_TRACK`, `UNREADABLE`,
  `CONVERSION_FAILED`) affiché dans la fiche ; l'utilisateur supprime le média. Le refus ne peut plus être immédiat
  (415) : la vérification complète demande ffprobe, qui ne tourne jamais dans une requête.
- Limites : celles des vidéos (512 Mio par défaut, 2 Gio − 1) ; durée ≤ `NUXT_VIDEO_MAX_DURATION` (défaut 3 h) pour
  qu'un fichier ne bloque pas la file des heures durant.

## 34. Rendus : modèle, stockage, diffusion (DD33)

```prisma
model MediaRendition {
  id         String   @id @default(cuid())
  mediaId    String
  version    Int
  name       String   // h264 | av1
  container  String   // mp4 | webm
  mimeType   String
  codecs     String   // RFC 6381 : avc1.640028,mp4a.40.2
  width      Int
  height     Int
  duration   Float
  bitrate    Int
  size       Int
  checksum   String
  storageKey String   @unique   // variants/<média>/v<n>-r-<nom>-<aléa>.<ext>
  createdAt  DateTime @default(now())
  media      Media    @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  @@unique([mediaId, version, name])
}
```

- Table à part (et non `MediaVariant`) : un rendu n'est pas une transformation d'image, ne compte pas dans le quota des
  50 dérivés, porte des codecs et un débit, et ne se génère jamais à la demande.
- **Diffusion** : `/m/<id>/v<n>/renditions/<nom>.<ext>` (segment `renditions` réservé, comme `tracks`), mêmes règles que
  l'original : `Range`, `ETag`, cache immuable pour un média public, liens signés, Bearer, corbeille → 404, ancienne
  version → 302 vers le rendu de la nouvelle s'il existe, sinon vers l'original.
- **Signature** : le droit `file` couvre l'original **et ses rendus** (même vidéo, même public) ; un lien signé pour
  le fichier donne donc aussi les URL signées des rendus à la même échéance.
- Un rendu est **supprimé** avec sa version (`deleteVersionVariants` étendu) et à la purge (préfixe `variants/<média>/`).

## 35. Contrats (DD34)

**API v1** (ajouts seulement) :
- `Media.processing` : `{ status: "pending" | "processing" | "ready" | "failed", progress: number | null, error: string | null,
  updatedAt }` ou `null` (image, ou vidéo jamais traitée).
- `Media.sources` : liste ordonnée par préférence, prête pour `<video><source src type>` — le navigateur prend la
  première qu'il sait lire :
  ```json
  [
    { "url": "…/renditions/av1.webm", "type": "video/webm; codecs=\"av01.0.08M.08,opus\"", "width": 1920, "height": 1080, "bitrate": 4800000, "size": 12114939, "rendition": "av1" },
    { "url": "…/renditions/h264.mp4", "type": "video/mp4; codecs=\"avc1.640028,mp4a.40.2\"", "width": 1920, "height": 1080, "bitrate": 5100000, "size": 12844349, "rendition": "h264" }
  ]
  ```
  Règle : rendus présents → rendus (AV1 d'abord, H.264 en dernier), l'original reste dans `url` ; aucun rendu → l'original
  seul s'il est lisible (`playback` ≠ `none`, `type` avec ses codecs) ; image ou format non lisible sans rendu → `[]`.
  URL signées si le média est privé (même échéance que `url`).
- `signed-url` cible `file` : réponse complétée par `sources` signées. Erreur `PROCESSING_FAILED` non exposée en
  dehors de `processing.error`.
- OpenAPI fr/en, section « Vidéos » : modes de traitement, `sources`, extrait `<video>` avec `<source>`, attente du
  traitement (lecture de `processing.status`, avec `ETag` / `If-None-Match` ; pas de webhooks en D3, transverse).

**Administration** :
- `MediaSummary.processingState` ; `MediaDetail.processing` (étape, progression, essais, erreur, dates),
  `MediaDetail.renditions[]`, `sources` (liens « admin » si privé).
- `POST /api/admin/media/:id/process` : relancer (tâche en échec ou rendus avec d'autres réglages) — droits de la
  modification du média ; `409 PROCESSING_DISABLED` si aucun mode actif.
- `POST /api/admin/video-processing/backfill` (ADMIN) : crée les tâches des vidéos existantes (`processingState`
  `null`), priorité basse ; `GET /api/admin/video-processing` : mode, ffmpeg (version, encodeurs, HDR), processus de
  travail vus, tâches par statut.
- `/api/health` : `videoProcessing: { mode, workers, queued }` (sans détail sensible).

## 36. Sécurité des fichiers hostiles (DD35)

ffmpeg décode des fichiers envoyés par des tiers (API, jetons délégués) : c'est la plus grande surface d'attaque du
projet. Défenses, toutes appliquées par une seule fonction de construction des arguments (pure, testée) :

- **Format d'entrée imposé** (`-f mov|matroska|avi|…`, d'après la détection de `sniff.ts`) : ffmpeg ne devine jamais le
  format. Attaque connue : un fichier `.avi` contenant en réalité une liste HLS qui lit des fichiers du serveur
  (`/etc/passwd`) ou des URL internes et les incruste dans la vidéo produite.
- **Protocoles** : `-protocol_whitelist file` (`file,pipe` pour la sortie de progression) ; les démultiplexeurs `hls`,
  `concat`, `dash` ne peuvent pas être choisis (format imposé).
- **Ressources** : priorité la plus basse (§ 29.3), `-threads` borné (`NUXT_VIDEO_THREADS`, défaut : moitié des cœurs),
  délai total `10 × durée + 120 s` (plafonné) puis arrêt de l'arbre de processus, dimensions décodées ≤ 16 384 px,
  sorties écrites dans un dossier temporaire propre à la tâche, taille de sortie ≤ 2 Gio − 1.
- **Sous Linux**, si disponible : limite de mémoire par `prlimit --as` (défaut 4 Gio) ; documentation d'un conteneur dédié
  au mode `external` (sans réseau, système de fichiers en lecture seule sauf le dossier temporaire).
- Les sorties sont **réanalysées par le lecteur de D1** avant d'être enregistrées ; les messages de ffmpeg ne sont
  jamais renvoyés tels quels à l'utilisateur (chemins du serveur), seulement un code et un résumé.
- **Mise à jour de ffmpeg** : version affichée dans « Réglages » ; la documentation recommande les paquets du système
  (correctifs de sécurité).

## 37. Interface (DD36)

- **Médiathèque** : pastille d'état sur la carte (« Conversion… », « Échec ») avec texte accessible, pas d'animation
  continue (WCAG 2.2.2) ; filtre « État » non prévu en D3.
- **Fiche** : section « Traitement » (étape, progression `role="progressbar"` + texte, essais, erreur, « Relancer ») ;
  rafraîchie toutes les 5 s **seulement** tant que la tâche est en attente ou en cours, annonce discrète à la fin
  (`role="status"`) ; liste des rendus (format, définition, débit, taille, lien) ; lecteur avec `<source>` dans l'ordre de
  `sources` ; avertissements revus : « compatibilité variable » → « Version compatible en préparation » puis disparaît ;
  « piste de données de l'appareil » ; « couleurs HDR converties ».
- **Réglages** : section « Traitement des vidéos » (mode, ffmpeg détecté, processus de travail, tâches par statut,
  « Traiter les vidéos existantes » avec confirmation et estimation du temps d'après les durées).
- **Envoi** : aide des formats complétée quand le traitement est actif (« MKV, AVI… acceptés, convertis après l'envoi »).
- Tout texte en `fr.json` / `en.json`, `pnpm i18n:check`, axe fr/en × clair/sombre, clavier, 375 px.

## 38. Réglages et performance

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NUXT_VIDEO_PROCESSING` | `off` | `off` \| `embedded` \| `external` (§ 30.2) |
| `NUXT_SERVER_ROLE` | `web` | `worker` pour un processus de travail |
| `NUXT_FFMPEG_PATH`, `NUXT_FFPROBE_PATH` | `ffmpeg`, `ffprobe` | binaires |
| `NUXT_VIDEO_CONCURRENCY` | 1 | tâches simultanées par processus |
| `NUXT_VIDEO_THREADS` | moitié des cœurs | fils par ffmpeg |
| `NUXT_VIDEO_RENDITION` | `auto` | `auto` \| `always` \| `never` (§ 32.2) |
| `NUXT_VIDEO_PRESET`, `NUXT_VIDEO_CRF` | `veryfast`, 23 | réglages du H.264 |
| `NUXT_VIDEO_AV1` | `off` | rendu AV1 en plus |
| `NUXT_VIDEO_MAX_DURATION` | 10 800 s | au-delà : pas de conversion (`FAILED`, `TOO_LONG`) |

**Garanties** : rien ne change pour une installation en `off` ; aucun appel à ffmpeg dans une requête ; le serveur web
ne fait, en `external`, qu'une insertion de plus par envoi vidéo ; en `embedded`, ffmpeg en priorité la plus basse
(mesuré) et fils bornés ; espace temporaire ≈ taille de l'original (copie S3) + sorties, par tâche simultanée
(documenté) ; stockage en plus : le rendu (souvent moins de la moitié de l'original d'un téléphone).

## 39. Décisions à valider (D3)

| # | Décision proposée | Alternative |
| --- | --- | --- |
| DD25 | **ffmpeg du système** (`NUXT_FFMPEG_PATH`), version ≥ 6 et encodeurs contrôlés au démarrage, processus enfant sans shell | `ffmpeg-static` (npm) ; ffmpeg WASM |
| DD26 | Modes **`off` (défaut) / `embedded` / `external`** ; processus de travail = même build avec `NUXT_SERVER_ROLE=worker` ; ffmpeg toujours en **priorité la plus basse** (mesuré § 29.3) | processus de travail seul (pas d'`embedded`) ; CLI séparée avec son propre build |
| DD27 | **File en base** `MediaJob` (prise atomique portable, bail 2 min, 3 essais, priorité) + `Media.processingState` ; une tâche par (média, version) | file Redis / BullMQ ; une tâche par étape |
| DD28 | **Sans perte → remplace l'original** (nouvelle version) ; **réencodage → rendu** à côté de l'original conservé | ne jamais modifier l'original après l'envoi |
| DD29 | **Un rendu H.264/AAC ≤ 1080p seulement s'il sert** (`auto`), `veryfast` CRF 23, HDR → SDR ; AV1 en option désactivée | rendu systématique ; 1080p + 720p ; AV1 par défaut |
| DD30 | **Affiche côté serveur** si aucune, jamais d'écrasement ; vignettes = dérivés de l'affiche ; planches de survol en D4 | régénérer à chaque nouvelle version ; planches dès D3 |
| DD31 | **Réparation WebM** et **retrait des pistes de métadonnées** par copie sans réencodage + filtre de D2 ; détection dès l'envoi ; **diffusion publique de l'original retenue (503) jusqu'au nettoyage** (choix validé) | original public pendant l'attente |
| DD32 | **MKV, AVI, 3GP, MPEG-TS/M2TS, OGV, WMV** acceptés seulement si le traitement est actif ; original en téléchargement ; durée ≤ 3 h | garder le refus de D1 ; liste plus courte (MKV, 3GP, M2TS) |
| DD33 | Table **`MediaRendition`**, `/m/<id>/v<n>/renditions/<nom>.<ext>`, droit signé `file` couvrant les rendus, relecture en base d'un rendu inconnu du cache | réutiliser `MediaVariant` ; droit signé `rendition:<nom>` |
| DD34 | API v1 : **`processing` et `sources[]` ajoutés** ; administration : relancer, traiter l'existant, état du traitement ; pas de webhooks en D3 | objet `video { … }` ; webhooks dès D3 |
| DD35 | **Défenses du § 36** (format imposé, protocole `file`, délais, priorité, fils, mémoire, réanalyse des sorties) | — |
| DD36 | Interface du § 37 ; **étape 22** en trois parties : (1) file, modes, ffmpeg, état, affiche serveur ; (2) rendus, `sources[]`, formats convertis ; (3) réparation WebM, pistes de métadonnées | tout en une fois |

## 40. Plan de vérification de D3

- **Vitest (sans ffmpeg)** : `planVideoJob` (toutes les règles du § 32), construction des arguments (format imposé,
  protocoles, fils, filtres HDR, rotation), lecture de `-progress`, prise et bail de la file (base SQLite de test),
  détection des nouveaux formats (`sniff.ts`) et des pistes de données (lecteur de D1, fichiers fabriqués boîte par boîte),
  ordre de `sources[]`, chemins `/renditions/` et signatures.
- **Vitest (avec ffmpeg)** : vidéos **fabriquées pendant le test** par ffmpeg (`lavfi` : HEVC tournée, HDR 10 bits, MKV,
  AVI, MPEG-TS, sans son, piste de données factice) — aucun fichier lourd dans le dépôt ; ces tests sont signalés
  « ignorés » quand ffmpeg manque (poste Windows sans ffmpeg), jamais réussis en silence.
- **Vrais fichiers** : enregistrements `MediaRecorder` du dépôt ; chez vous, `v1.mp4` et la vidéo de téléphone (HEVC,
  rotation) : rendu lu dans le navigateur, images comparées ; une vidéo GoPro ou de drone si vous en avez une.
- **Fichiers hostiles** : AVI contenant une liste HLS qui vise `file:///etc/passwd` et une URL locale → échec propre,
  aucune lecture ni requête (vérifié par un serveur témoin) ; fichier tronqué ; dimensions absurdes ; boucle de
  décodage (délai).
- **Scénario HTTP** `d3-test.mjs` (à recréer, dans le dépôt seulement avec votre accord) : envoi → tâche → rendu,
  remplacement pendant le traitement, corbeille, duplication, purge, processus de travail tué pendant un encodage
  (reprise par le bail), deux processus de travail (pas de double prise), mode `off`, API v1 (`processing`, `sources`
  publiques et signées), `Range` sur les rendus.
- **Charge** : banc du § 29.3 rejoué contre le vrai serveur en `embedded` (latence de `/m/` et de l'API pendant un
  encodage).
- **Non-régression** : `pnpm typecheck`, `pnpm test`, `pnpm i18n:check`, `db:migration --check` (3 fournisseurs), build
  de production (traçage : aucune nouvelle dépendance npm prévue), axe fr/en × clair/sombre.

## 41. Risques et limites de D3

- **ffmpeg sous Windows** : les builds courants ne sont pas signés ; Smart App Control peut les bloquer comme argon2 — à
  vérifier sur votre poste avant la partie 1 (`winget install Gyan.FFmpeg` puis `ffmpeg -version`).
- **Failles de ffmpeg** : réduites (§ 36), jamais nulles ; le mode `external` dans un conteneur isolé est la
  recommandation pour une installation ouverte aux envois de tiers.
- **SQLite + processus de travail séparé** : même machine seulement ; écritures sérialisées (tâches courtes, délai
  d'attente des verrous déjà en place à vérifier).
- **Nouvelle version après nettoyage ou réparation** : un lien copié juste après l'envoi passe par une redirection
  (302) ; les intégrations qui gardent l'URL versionnée continuent de fonctionner.
- **Espace de stockage** : un rendu en plus de l'original pour les vidéos concernées.
- Temps de conversion proportionnel à la durée : une heure de vidéo ≈ 30 min sur 4 cœurs (§ 29.2), file d'attente
  visible.
- Node 22 dans la machine du nuage : utiliser Node 24 (déjà exigé), sinon un test de D2 échoue (§ 29.1).

## 42. Hors D3 (pour mémoire)

HLS multi-débits, planches de survol, manifestes signés (D4) ; webhooks de fin de traitement ; accélération matérielle
(NVENC, Quick Sync, VideoToolbox) ; sous-titres automatiques ; audio seul ; envois reprenables et directs vers S3 ;
fichiers > 2 Gio ; filtre « État » dans la médiathèque ; composant `<SmVideo>`.

---

# D3 — état de l'implémentation (2026-10-08, session du nuage)

> Spécification de travail des modules (contrats, propriété des fichiers, raffinements) :
> `.claude/d3-implementation-notes.md`. **Étape 22 de `setup.md` pas encore écrite** (à faire à la fin de D3).

## Fait (branche `main-7i2ki7`, fusionnée dans `main`)

| Module | Contenu | Fichiers principaux |
| --- | --- | --- |
| Fondations | schéma + migration `d3_video_processing` (3 bases), constantes et règles partagées, réglages `NUXT_VIDEO_*`, `NUXT_SERVER_ROLE`, `NUXT_FFMPEG_PATH` | `prisma/`, `shared/utils/video-processing.ts`, `shared/utils/{video,media}.ts`, `server/lib/video-processing/settings.ts` |
| A — ffmpeg | détection, exécution bornée (priorité 19, groupe de processus, `prlimit` mémoire + temps processeur, environnement réduit, délais, garde de durée de sortie), arguments (format imposé, `-protocol_whitelist file`, `-enable_drefs 0`, `-max_pixels`, `-fs`, désentrelacement `bwdif`, `-fpsmax 60`, HDR → SDR), ffprobe, plan pur | `server/lib/video-processing/{ffmpeg,run,args,ffprobe,plan}.ts` |
| B — diffusion | cible `renditions`, retenue 503, liens « admin » pour une vidéo publique retenue, relecture du cache (rendu inconnu, affiche d'une vidéo sans affiche, version plus récente), téléchargement des originaux non lisibles | `server/lib/media/{delivery-path,delivery,cache,urls,renditions,keys}.ts`, `server/routes/m/[...path].ts` |
| C — détection | 3GP, MKV, AVI, WMV, Ogg Theora, MPEG-TS/M2TS ; pistes de données (`gpmd`, `camm`, `mebx`, `djmd`…) ; règles d'envoi par intersection ; 415 (et non 413 « 0 octet ») quand aucun type n'est admis | `server/lib/media/{sniff,limits,upload}.ts`, `video/probe.ts`, `handlers/video.ts` |
| D — file et pipeline | file persistante (prise atomique, bail, reprise, rattrapage périodique, présence), boucle + superviseur (nouvel essai au démarrage, reprise après une panne de ffmpeg), pipeline (probe, sanitize, repair, transcode, av1, poster, vérification de chaque sortie par le lecteur de D1), intégration au service (création, remplacement, corbeille, restauration, duplication, relance, traitement de l'existant), rôle `worker`, `surge-media worker`, `.env.example` | `server/lib/video-processing/{jobs,runner,pipeline,status,worker-id}.ts`, `server/lib/media/service.ts`, `server/plugins/0.video-processing.ts`, `server/middleware/0.server-role.ts`, `cli/worker.ts` |

Chaque module a été revu par des relecteurs indépendants (défauts reproduits puis corrigés, chacun avec un test) :
13 défauts en phase B, 11 en phase C (dont 3 majeurs : réécriture annulée par un changement de version
concurrent, processus arrêté qui se disait actif, nettoyage des dossiers temporaires d'une autre installation).

## Écarts à la proposition (§ 28–42)

- **Validité d'une tâche par fichier** (`MediaJob.sourceKey`, pas la version) ; **clés des rendus indépendantes de
  la version** (`variants/<média>/rendition-<nom>-<aléa>.<ext>`) : un changement d'affiche ou de point d'intérêt ne
  touche ni les tâches ni les rendus ; remplacer un rendu existant (relance) change la version.
- `TOO_LONG` n'empêche que les réencodages : retrait des pistes GPS, réparation et affiche sont faits, puis échec.
- Mode `auto` : une source **entrelacée** reçoit aussi un rendu (les navigateurs ne désentrelacent pas).
- Fils de ffmpeg plafonnés à 16 (mémoire sous `prlimit`), `MALLOC_ARENA_MAX=2`.
- Réparation WebM seulement pour VP8/VP9/AV1 + Opus/Vorbis (sinon le rendu H.264 suffit).
- Vidéo dont la diffusion est retenue : priorité 10 dans la file ; ses liens d'administration sont signés « admin ».
- « Actif » (mode `embedded`) exige aussi que la boucle tourne ; processus de travail arrêté : présence `halted`,
  effacée à l'arrêt propre.
- Développement : ffmpeg reste dans le groupe du terminal (Ctrl+C sur `nuxt dev` l'arrête) ; au démarrage suivant,
  le bail de ses tâches est rendu échu aussitôt. Windows : la CLI `worker` ne retransmet pas les signaux (le Ctrl+C
  de la console suffit ; `child.kill` y tuerait le processus sans arrêt propre).
- Point de rafraîchissement léger prévu pour la fiche (`GET /api/admin/media/:id/processing`, module E).

## Vérifié (2026-10-08)

- `pnpm test` : **449 tests** (22 fichiers ; ffmpeg réel dans `tests/video-ffmpeg.test.ts`, ignoré sans ffmpeg),
  `pnpm typecheck`, `pnpm db:migration --check`, `pnpm i18n:check` : verts (Node 24).
- Serveur de développement, mode `embedded`, base et stockage copiés : HEVC → prête en 2 s (affiche du serveur) ;
  ffprobe retiré en cours de route → tâche rendue sans essai compté, traitement inactif (MKV refusé 415), reprise
  automatique 56 s après son retour ; Ctrl+C pendant un encodage → aucun ffmpeg orphelin, reprise au redémarrage ;
  dossier temporaire d'une autre installation conservé. Bancs des relecteurs rejoués : défauts disparus.
- Pendant la phase C (relecteurs et implémentation) : build de production + `surge-media worker` en mode `external`
  (prise en 4,6 s, présence, 404 hors `/api/health`, SIGTERM → tâche rendue), HEVC HLG → SDR, MKV → rendu +
  original en téléchargement, GoPro `gpmd` → 503 puis v2 sans piste, WebM réparé, remplacement / corbeille /
  restauration / duplication pendant un encodage, plantage → reprise par le bail, 4 processus sur une même base
  SQLite (80 tâches, aucune double prise).

## Reste à faire

1. **Module E — contrats** : `Media.processing` et `Media.sources[]` (API v1, OpenAPI fr/en, `mediaEtag` avec
   l'avancement), `MediaSummary.processingState`, `MediaDetail.processing/renditions/sources`, routes
   `POST /api/admin/media/:id/process`, `GET /api/admin/media/:id/processing`, `GET /api/admin/video-processing`,
   `POST /api/admin/video-processing/backfill` (journal), `/api/health` (`videoProcessing`), `config/media`
   (`videoProcessing`), `videoSnippet` avec `sources`, types convertis dans `upload.types` des jetons délégués.
   Les fonctions du service existent déjà : `requestProcessing`, `backfillProcessing`, `processingDetail`,
   `listWorkers`, `jobCounts`, `backfillCandidates`, `videoProcessingActive`.
2. **Module F — interface** : pastille d'état des cartes, section « Traitement » de la fiche (rafraîchie toutes
   les 5 s seulement pendant le traitement, sans réinitialiser les formulaires), lecteur avec `<source>`, liste des
   rendus, avertissements (`compatPending`, `dataTracks`, `hdr`, `converting`), section « Traitement des vidéos »
   de « Réglages », aide d'envoi des formats convertis ; i18n fr/en, axe fr/en × clair/sombre.
3. **Documentation** : `setup.md` étape 22 et § 7.7 (modes, processus de travail, Docker, mandataire, dépannage
   ffmpeg/Smart App Control), `project-context.md` § 9.23 ; textes « 256 premiers octets » et « Matroska refusé »
   à corriger (setup.md, project-context § 9.4 et § 9.21, § 6 de ce document).
4. **Sous Windows (poste de l'utilisateur)** : ffmpeg installé et non bloqué par Smart App Control, `taskkill`,
   Ctrl+C de `surge-media worker`, tests ffmpeg.

## Limites connues

- Original **3GP/MKV** gardé tel quel (téléchargement) : un lieu de tournage qu'il contiendrait n'est ni détecté
  ni retiré (le rendu H.264, lui, n'a aucune métadonnée).
- Mode `external` : formats convertis refusés jusqu'à 30 s après le démarrage d'un processus de travail ; retenue
  (503) et affiche visibles avec jusqu'à 60 s de retard sur le serveur web (caches) ; processus de travail sur une
  autre machine : PostgreSQL/MySQL et stockage partagé obligatoires.
- Production, arrêt brutal (SIGKILL, panne) : ffmpeg peut finir seul (borné par `prlimit --cpu`), la tâche est
  reprise à l'expiration du bail (2 min, un essai compté).
- Antérieur à D3, observé pendant les essais : un aperçu pré-généré pendant un changement de version peut rester
  orphelin dans le stockage (`variants/<média>/v<n>-…`).
