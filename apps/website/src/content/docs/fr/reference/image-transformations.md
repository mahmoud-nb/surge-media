---
title: Transformations d’images
description: Grammaire des URL, paramètres, formats, préréglages, limites et erreurs des transformations d’images à la volée de surgeMedia (Sharp).
---

Toute image se transforme par son URL de diffusion. La variante est générée à la première requête, conservée, puis servie comme n’importe quel fichier statique.

## Grammaire des URL

```text
/m/<id>/v<version>/<segment>/<nom>.<format>
```

- **`<segment>`** est soit le nom d’un **préréglage** (`preview`, `full`, ou l’un des vôtres), soit une liste de **paramètres** `clé_valeur` séparés par des virgules.
- **`<format>`** — l’extension — est le format de sortie : `jpg`, `png`, `webp` ou `avif` (`jpeg` redirige vers `jpg`).
- **`<nom>`** est une version lisible du titre du média ; il n’influe pas sur le résultat.

```text
/m/k7d2m9qz/v3/w_800,h_450,q_70/hero.avif     paramètres libres
/m/k7d2m9qz/v3/preview/hero.webp              préréglage intégré : aperçu de 480 px
/m/k7d2m9qz/v3/full/hero.jpg                  préréglage intégré : image entière réencodée
/m/k7d2m9qz/v3/card/hero.webp                 votre propre préréglage
```

L’API des médias renvoie pour chaque média un `urlTemplate` prêt à l’emploi (`…/{transform}/hero.{format}`).

## Paramètres

| Paramètre | Valeurs | Défaut | Effet |
| --- | --- | --- | --- |
| `w`, `h` | 1 à 4096 | — | Largeur et hauteur cibles. |
| `fit` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` | Stratégie quand `w` et `h` sont tous deux fixés. Avec une seule dimension, l’image est réduite proportionnellement. |
| `g` | `center`, `north` … `northwest`, `attention`, `entropy`, `focal` | `focal` | Ancrage de `fit_cover`. `focal` utilise le point d’intérêt du média (défini dans l’administration ou par l’API), le centre à défaut. |
| `crop` | `x-y-largeur-hauteur` (pixels) | — | Zone à extraire, avant le redimensionnement. |
| `r` | `90`, `180`, `270` | 0 | Rotation horaire. |
| `flip` | `h`, `v`, `hv` | — | Miroir horizontal, vertical ou les deux. |
| `dpr` | 1 à 3, par pas de 0,5 | 1 | Multiplie `w` et `h` (pour les écrans Retina). |
| `q` | 1 à 100 | JPEG 80, WebP 80, AVIF 50 | Qualité. Le PNG est sans perte, sauf si `q` est fixé (palette). |
| `bg` | `rrggbb` | transparent (blanc en JPEG) | Fond de `fit_contain` et de la transparence convertie en JPEG. |

Les opérations s’exécutent toujours dans le même ordre : orientation EXIF → rotation → miroir → recadrage → redimensionnement → fond → encodage.

## Garanties

- **Jamais d’agrandissement.** Une demande plus grande que l’image est réduite en gardant le rapport demandé.
- **Des sorties propres.** Les métadonnées (EXIF, GPS, appareil) sont retirées et les couleurs converties en sRVB.
- **Des URL canoniques.** Les paramètres sont réordonnés et les valeurs par défaut retirées ; une URL non canonique reçoit une redirection `301` vers la forme canonique, pour que les caches ne stockent qu’une copie.
- **Un fichier par opération effective.** `w_1600`, `w_4096` et `full` sur une image de 1 200 px produisent le même fichier.
- **Un cache immuable.** Les variantes publiques sont servies avec un cache immuable d’un an ; une nouvelle version du média reçoit de nouvelles URL.

## Préréglages

Un préréglage donne un nom à une transformation (`card` = `w_600,h_400,q_75`). Les préréglages se définissent au niveau de l’installation (tous les projets) ou par projet, depuis l’administration. Modifier la définition d’un préréglage met à jour toutes les pages qui l’utilisent — sans changement de code ni redéploiement.

## Politiques et limites

Chaque projet choisit ce que les paramètres libres peuvent faire : `OPEN` (par défaut), `SIGNED` (URL signées ou identifiants d’API uniquement) ou `PRESETS` (préréglages uniquement). Voir [Sécurité et contrôle d’accès](../../guides/security/#politiques-de-transformation).

| Garde-fou | Défaut |
| --- | --- |
| Dimension maximale en sortie | 4 096 px |
| Variantes par version de média | 50 |
| Nouvelles générations non signées par IP et par minute | 60 (à mettre à 0 derrière un CDN) |

## Erreurs

| Statut | Code | Signification |
| --- | --- | --- |
| `400` | `INVALID_TRANSFORM` | Paramètre inconnu, valeur hors limites, recadrage hors de l’image, format désactivé. |
| `403` | `TRANSFORM_NOT_ALLOWED` | La politique du projet refuse les paramètres libres pour cette requête. |
| `404` | `PRESET_NOT_FOUND` | Préréglage inconnu. |
| `429` | `TRANSFORM_QUOTA` | Trop de variantes pour ce média, ou trop de générations depuis cette adresse IP (`Retry-After`). |
| `503` | `SERVER_BUSY` | File de traitement pleine — réessayez après `Retry-After` secondes. |
