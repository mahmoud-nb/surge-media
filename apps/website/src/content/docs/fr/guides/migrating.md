---
title: Migrer vers SurgeMedia
description: Reprenez vos images et vos vidéos existantes depuis un dossier, un bucket S3 ou une liste d’URL, réécrivez les URL de votre base et redirigez les anciennes adresses.
---

Vous avez déjà des médias : dans un dossier `uploads` sur votre serveur, dans un bucket S3, ou derrière des URL rangées dans votre base. SurgeMedia ne diffuse que les médias qu’il a enregistrés : ces fichiers sont donc **importés une fois** avec la commande `surge-media import`. L’import est gratuit, reprenable et sans risque à relancer : il ne crée jamais deux fois le même média.

La commande est un client de l’[API](../architecture/) : chaque fichier passe par le même chemin d’envoi que votre application (détection du type, limites, analyse, aperçus, traitement vidéo, journal d’audit). Rien n’est lu sur place : les fichiers sont **copiés** dans le stockage de SurgeMedia, et leur emplacement d’origine reste intact jusqu’à ce que vous le supprimiez.

## Les étapes en bref

1. **Préparer** un projet, une clé et, pour un gros import, des limites de débit relevées.
2. **Planifier** : lister les fichiers dans un manifeste, un fichier CSV que vous pouvez compléter.
3. **Essai à blanc** : tout vérifier sans rien envoyer.
4. **Importer**, et relancer la même commande après une interruption.
5. **Réécrire vos URL** à partir de la table de correspondance écrite par l’import.
6. **Rediriger** les anciennes adresses, si leur domaine vous appartient.
7. **Décommissionner** l’ancien emplacement quand plus rien ne l’utilise.

Dès l’étape 1, les nouveaux envois passent déjà par SurgeMedia (administration, API, composants d’envoi) : l’import ne concerne que l’existant.

## 1. Préparer

- **Un projet** où importer. L’API ne joint que les projets : pour placer des médias dans la bibliothèque partagée, importez-les dans un projet, puis déplacez-les depuis l’administration.
- **Une clé secrète** de ce projet avec la portée `media:upload`, plus `media:write` si l’import crée des dossiers et `tags:manage` s’il crée des étiquettes. Un jeton personnel avec les mêmes portées convient aussi ; il demande alors `--project <slug>`.
- **L’adresse de votre instance**, par exemple `https://media.example.com`, et la commande elle-même : `npx surge-media` avec le paquet npm, ou la même commande dans le conteneur Docker.

La clé est lue dans la variable d’environnement `SURGE_MEDIA_API_KEY` ou dans un fichier (`--key-file`), jamais sur la ligne de commande, où elle resterait dans l’historique du shell.

### Limites de débit pour un gros import

Par défaut, l’API accepte **60 envois par minute** et par clé, et chaque fichier coûte jusqu’à trois requêtes (recherche par référence, recherche par contenu, envoi). Au-delà de quelques centaines de fichiers, relevez les deux limites sur le serveur le temps de l’import, redémarrez-le, puis remettez-les à leur valeur :

```bash
NUXT_API_RATE_LIMIT_UPLOADS="100000"
NUXT_API_RATE_LIMIT_SECRET="100000"     # NUXT_API_RATE_LIMIT_PERSONAL avec un jeton personnel
```

Pour donner un ordre de grandeur, mesuré sur un ordinateur portable avec SQLite et un stockage local : 5 000 images (5,9 Go) prennent environ **84 minutes** aux limites par défaut, environ **12 minutes** avec la seule limite des envois relevée, et environ **7 minutes** avec les deux. La commande indique quelle limite l’a freinée et quelle variable relever.

## 2. Planifier

`import plan` liste les fichiers d’un dossier ou d’un bucket et écrit un **manifeste**, une ligne par fichier, avec le type reconnu d’après le contenu. Aucun serveur SurgeMedia n’est nécessaire.

```bash
npx surge-media import plan --from /var/www/uploads --folders-from-path --out uploads.csv
```

Depuis un bucket S3 (AWS S3, Cloudflare R2, MinIO, Scaleway, OVHcloud…), avec les identifiants de **ce** bucket, qui n’ont besoin que de lister et de lire :

```bash
export SURGE_MEDIA_IMPORT_S3_ACCESS_KEY_ID=…
export SURGE_MEDIA_IMPORT_S3_SECRET_ACCESS_KEY=…
npx surge-media import plan --from s3://anciens-medias/uploads/ --s3-region eu-west-3 --folders-from-path --out uploads.csv
```

Pour un service compatible S3, ajoutez `--s3-endpoint https://…` et, si le service le demande (MinIO, Garage), `--s3-path-style`.

`plan` indique le volume total, la durée estimée et les fichiers qu’il écarte (dans `uploads.rejected.csv`) : les SVG, HEIC et TIFF ne sont pas acceptés, et les vidéos MKV, AVI et semblables seulement si le traitement vidéo est actif. `--folders-from-path` transforme l’arborescence en dossiers du projet.

### Écrire ou compléter le manifeste

Le manifeste est un simple fichier CSV (UTF-8, séparateur virgule, une ligne d’en-tête) ; seule `source` est obligatoire. Modifiez-le avant l’import, ou **exportez-le depuis votre propre base**, la meilleure façon de reprendre titres, textes alternatifs et références :

| Colonne | Contenu |
| --- | --- |
| `source` | Chemin relatif à `--root`, URL `http(s)://` ou adresse `s3://bucket/clé` |
| `ref` | Référence du fichier dans votre système, 191 caractères au plus (par défaut : `source`) |
| `title`, `alt` | Titre et texte alternatif |
| `visibility` | `public` (par défaut) ou `private` |
| `folder` | Dossier du projet, par exemple `blog/2024` |
| `tags` | Slugs d’étiquettes séparés par `\|` |
| `filename` | Nom de fichier à enregistrer (par défaut : le dernier segment de `source`) |

```sql
-- PostgreSQL : une ligne par image de votre CMS, sa clé primaire comme référence
\copy (SELECT url AS source, 'img:' || id AS ref, title, alt_text AS alt FROM images) TO 'uploads.csv' WITH (FORMAT csv, HEADER true)
```

Choisissez bien `ref` : c’est ainsi que l’import reconnaît un fichier déjà importé, et que vous retrouverez vos lignes à l’étape 5. Votre propre clé primaire (`img:4812`) est le choix le plus sûr.

## 3. Essai à blanc

```bash
export SURGE_MEDIA_API_KEY=sm_sk_…
npx surge-media import run uploads.csv --root /var/www/uploads --url https://media.example.com --create-folders --dry-run
```

L’essai à blanc fait tout sauf l’envoi : il lit chaque fichier, applique les règles de votre serveur (types acceptés, tailles maximales), repère les fichiers déjà importés et les doublons, et compte les dossiers et les étiquettes à créer. Rien n’est écrit sur le serveur.

## 4. Importer

Relancez la même commande sans `--dry-run` :

```bash
npx surge-media import run uploads.csv --root /var/www/uploads --url https://media.example.com --create-folders
```

Pour chaque ligne, la commande lit le fichier (une URL ou un objet `s3://` est d’abord téléchargé dans un dossier temporaire), le saute si sa référence est déjà sur le serveur, le rattache au média existant si le projet contient déjà le même contenu (`--no-dedupe` pour l’envoyer quand même), et sinon l’envoie.

- **Interrompre et reprendre.** Un Ctrl+C : les envois en cours se terminent, la table de correspondance est écrite, et la commande s’arrête avec le code `2`. Relancez la même commande pour reprendre là où elle s’est arrêtée. Même si le fichier de progression est perdu, rien n’est dupliqué : le serveur refuse une référence qu’il connaît déjà.
- **Codes de sortie.** `0` : toutes les lignes sont réglées, refus définitifs compris. `2` : des lignes ont échoué ou restent, relancez la commande. `1` : la commande n’a pas pu tourner (adresse, clé, manifeste).
- **Les vidéos** sont traitées en arrière-plan avec une priorité plus basse que vos envois courants : un long import ne retarde jamais le travail de vos équipes.
- **Options.** `--concurrency` (2 par défaut, 8 au plus), `--visibility`, `--create-tags`, `--public-url` (voir plus bas), `--retry-rejected` après un changement de réglage du serveur, `--json` pour un script.

## 5. Réécrire vos URL

À côté du manifeste, l’import écrit **`uploads.mapping.csv`**, une ligne par ligne du manifeste :

| Colonne | Contenu |
| --- | --- |
| `source` | La `source` du manifeste |
| `sourceRef` | La référence enregistrée sur le serveur (la colonne `ref`, ou `source`) |
| `status` | `created`, `exists` (importé plus tôt), `deduplicated` (même contenu qu’un autre média), `rejected`, `failed` ou `pending` |
| `mediaId` | Identifiant du média SurgeMedia |
| `version` | Version du fichier |
| `url` | URL de diffusion de l’original, par exemple `https://media.example.com/m/<id>/v1/photo.jpg` |
| `code` | Code d’erreur d’une ligne refusée ou en échec |

Chargez-la dans votre base et mettez vos lignes à jour. **Stockez l’identifiant du média** plutôt que la seule URL : avec l’identifiant, votre application affiche toujours la version courante après un remplacement de fichier, produit des images redimensionnées et converties, et lit les médias privés par des URL signées. L’URL d’un média privé est donnée sans sa signature temporaire et ne fonctionne pas seule.

### PostgreSQL

```sql
CREATE TEMP TABLE surge_media_mapping (
  source     text,
  source_ref text,
  status     text,
  media_id   text,
  version    integer,
  url        text,
  code       text
);
\copy surge_media_mapping FROM 'uploads.mapping.csv' WITH (FORMAT csv, HEADER true)

ALTER TABLE images ADD COLUMN surge_media_id text;

UPDATE images AS i
SET    surge_media_id = m.media_id,
       url            = m.url
FROM   surge_media_mapping AS m
WHERE  m.status IN ('created', 'exists', 'deduplicated')
AND    m.source_ref = 'img:' || i.id;   -- ou : m.source = i.url
```

### MySQL et MariaDB

```sql
CREATE TEMPORARY TABLE surge_media_mapping (
  source     VARCHAR(2048) NOT NULL,
  source_ref VARCHAR(191)  NOT NULL,
  status     VARCHAR(16)   NOT NULL,
  media_id   VARCHAR(32),
  version    INT,
  url        VARCHAR(2048),
  code       VARCHAR(64),
  KEY (source_ref)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

LOAD DATA LOCAL INFILE 'uploads.mapping.csv'
INTO TABLE surge_media_mapping
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY ''
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(source, source_ref, status, @media_id, @version, @url, @code)
SET media_id = NULLIF(@media_id, ''), version = NULLIF(@version, ''),
    url = NULLIF(@url, ''), code = NULLIF(@code, '');

ALTER TABLE images ADD COLUMN surge_media_id VARCHAR(32) NULL;

UPDATE images AS i
JOIN   surge_media_mapping AS m
       ON m.source_ref = CONCAT('img:', i.id)   -- ou : ON m.source = i.url COLLATE utf8mb4_bin
SET    i.surge_media_id = m.media_id,
       i.url            = m.url
WHERE  m.status IN ('created', 'exists', 'deduplicated');
```

`LOAD DATA LOCAL` demande `local_infile` côté serveur et côté client (`mysql --local-infile=1`). La collation binaire compare les références à l’identique, comme SurgeMedia : les collations par défaut de MySQL ignorent la casse et les accents.

Affichez ensuite les médias par leur identifiant, par exemple avec le [client JavaScript et les composants Vue](../../reference/sdks/) : `client.media.get(id)` renvoie le média que `SmImage` affiche avec son `srcset`.

:::tip[Domaine public dans la table de correspondance]
Les URL de la table utilisent l’adresse publique de votre instance (`NUXT_MEDIA_PUBLIC_URL`, sinon `NUXT_SITE_URL`). Si aucune n’est définie, par exemple quand vous lancez l’import sur le serveur lui-même, passez `--public-url https://media.example.com`.
:::

## 6. Rediriger les anciennes adresses

Quand les anciennes URL sont servies par un domaine que vous contrôlez, transformez la table de correspondance en redirections permanentes (301), pour que les liens des e-mails, des moteurs de recherche et des autres sites continuent de fonctionner :

```bash
npx surge-media import redirects uploads.mapping.csv --format nginx --prefix /uploads --out surge-media-redirects.conf
```

| `--format` | Résultat |
| --- | --- |
| `nginx` | Une table `map` à inclure dans le bloc `http`, plus une ligne `if … return 301` dans l’ancien bloc `server` |
| `caddy` | Une table `map {path}` suivie de `redir`, à importer dans l’ancien bloc du site |
| `apache` | Une ligne `RedirectMatch 301` par adresse, pour le VirtualHost ou le `.htaccess` |
| `cloudflare` | Le CSV des Bulk Redirects (demande `--origin https://www.example.com`) |
| `json` | La liste brute, pour tout autre outil |

L’ancienne adresse d’un fichier est le chemin de son URL quand `source` est une URL ; pour un chemin ou une clé `s3://`, c’est `--prefix` suivi du chemin. Les règles portent sur le chemin exact et ignorent la chaîne de requête. Les adresses qui contiennent un caractère interprété par la syntaxe de configuration sont écartées et listées. Testez toujours le fichier avant de le charger (`nginx -t`, `caddy validate`, `apachectl configtest`).

Si les anciennes URL appartiennent à un service que vous quittez (un CDN ou une plateforme de médias SaaS), vous ne pouvez pas les rediriger : gardez l’ancien service en lecture seule jusqu’à ce que votre base et vos pages ne contiennent plus que les nouvelles URL.

## 7. Décommissionner

1. Vérifiez qu’aucune page, aucun modèle d’e-mail ni aucune application n’appelle encore les anciennes adresses : surveillez les journaux de l’ancien serveur, ou les passages par les redirections.
2. Gardez les redirections tant que des liens extérieurs peuvent viser les anciennes URL ; elles ne coûtent rien.
3. Supprimez les anciens fichiers, ou le bucket, et révoquez les identifiants de l’import : la clé de lecture du bucket, et la clé SurgeMedia si elle n’a servi qu’à cela. Remettez les limites de débit à leur valeur par défaut.

## Bon à savoir

- **Dates** : la date de création d’un média importé est celle de l’import.
- **Les dérivés** produits par votre ancien système (vignettes, recadrages) ne sont pas importés : SurgeMedia les produit à la demande depuis l’original.
- **Un même fichier deux fois dans la source** : il est envoyé une fois ; chaque ligne pointe vers le même média dans la table de correspondance.
- **Avec Docker**, lancez la commande depuis l’hôte avec Node.js, ou dans le conteneur quand les fichiers y sont montés : `docker compose exec -e SURGE_MEDIA_API_KEY surge-media node node_modules/@surge-media/core/dist/cli/index.mjs import run /import/uploads.csv`.

Le [guide d’installation](https://github.com/mahmoud-nb/surge-media/blob/main/setup.md#91-importing-existing-media) (en anglais) détaille toutes les options des commandes `import`.
