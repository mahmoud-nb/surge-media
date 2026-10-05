# Phase D — Vidéos : envoi, stockage, gestion et diffusion directe

> **Statut : VALIDÉE (2026-10-05) — décisions DD1 à DD14 acceptées par l'utilisateur. D1 FAITE (2026-10-05)** : `setup.md`
> étape 20 et § 7.7, `.claude/project-context.md` § 9.21. Suite (D2 à D4, transverses : § 14) à proposer et faire valider.
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
