---
title: Image transformations
description: URL grammar, parameters, formats, presets, limits and errors of SurgeMedia's on-the-fly image transformations (Sharp).
---

Every image can be transformed by its delivery URL. The variant is generated on the first request, stored, and then served like any static file.

## URL grammar

```text
/m/<id>/v<version>/<segment>/<name>.<format>
```

- **`<segment>`** is either a **preset** name (`preview`, `full`, or one of your presets), or a list of `key_value` **parameters** separated by commas.
- **`<format>`** — the extension — is the output format: `jpg`, `png`, `webp` or `avif` (`jpeg` redirects to `jpg`).
- **`<name>`** is a readable slug of the media title; it does not affect the result.

```text
/m/k7d2m9qz/v3/w_800,h_450,q_70/hero.avif     free parameters
/m/k7d2m9qz/v3/preview/hero.webp              built-in preset: 480 px preview
/m/k7d2m9qz/v3/full/hero.jpg                  built-in preset: full image, re-encoded
/m/k7d2m9qz/v3/card/hero.webp                 your own preset
```

The media API returns a ready-made `urlTemplate` (`…/{transform}/hero.{format}`) for each media.

## Parameters

| Parameter | Values | Default | Effect |
| --- | --- | --- | --- |
| `w`, `h` | 1 to 4096 | — | Target width and height. |
| `fit` | `cover`, `contain`, `fill`, `inside`, `outside` | `cover` | Strategy when both `w` and `h` are set. With one dimension, the image is scaled proportionally. |
| `g` | `center`, `north` … `northwest`, `attention`, `entropy`, `focal` | `focal` | Anchor of `fit_cover`. `focal` uses the media's focal point (set in the admin or the API), the center otherwise. |
| `crop` | `x-y-width-height` (pixels) | — | Area to extract, before resizing. |
| `r` | `90`, `180`, `270` | 0 | Clockwise rotation. |
| `flip` | `h`, `v`, `hv` | — | Horizontal, vertical or both. |
| `dpr` | 1 to 3, by 0.5 | 1 | Multiplies `w` and `h` (for Retina screens). |
| `q` | 1 to 100 | JPEG 80, WebP 80, AVIF 50 | Quality. PNG is lossless unless `q` is set (palette). |
| `bg` | `rrggbb` | transparent (white for JPEG) | Background for `fit_contain` and for transparency converted to JPEG. |

Operations always run in the same order: EXIF orientation → rotation → flip → crop → resize → background → encoding.

## Guarantees

- **Never upscaled.** A request larger than the image is reduced while keeping the requested aspect ratio.
- **Clean output.** Metadata (EXIF, GPS, camera) is stripped and colors are converted to sRGB.
- **Canonical URLs.** Parameters are reordered and defaults removed; a non-canonical URL gets a `301` to the canonical one, so caches store a single copy.
- **One file per effective operation.** `w_1600`, `w_4096` and `full` on a 1,200 px image produce the same file.
- **Immutable caching.** Public variants are served with a one-year immutable cache; a new media version gets new URLs.

## Presets

A preset gives a name to a transformation (`card` = `w_600,h_400,q_75`). Presets are defined at installation level (all projects) or per project, from the admin. Changing a preset's definition updates every page that uses it — no code change, no redeployment.

## Policies and limits

Each project chooses what free parameters can do: `OPEN` (default), `SIGNED` (signed URLs or API credentials only) or `PRESETS` (presets only). See [Security & access control](../../guides/security/#transformation-policies).

| Safeguard | Default |
| --- | --- |
| Maximum output dimension | 4,096 px |
| Variants per media version | 50 |
| New unsigned generations per IP and per minute | 60 (set to 0 behind a CDN) |

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_TRANSFORM` | Unknown parameter, out-of-range value, crop outside the image, disabled format. |
| `403` | `TRANSFORM_NOT_ALLOWED` | The project's policy refuses free parameters for this request. |
| `404` | `PRESET_NOT_FOUND` | Unknown preset. |
| `429` | `TRANSFORM_QUOTA` | Too many variants for this media, or too many generations from this IP (`Retry-After`). |
| `503` | `SERVER_BUSY` | Processing queue full — retry after `Retry-After` seconds. |
