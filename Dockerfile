# syntax=docker/dockerfile:1.7
#
# surgeMedia — image du core : administration, API, diffusion et traitement des médias.
#
#   docker build -t surge-media .                     image complète, avec ffmpeg (cible « full », par défaut)
#   docker build --target slim -t surge-media:slim .  sans ffmpeg (traitement des vidéos impossible)
#
# L'image installe le paquet npm @surge-media/core : celui que l'étape « build » construit depuis les sources, ou
# un paquet déjà construit avec --build-context package=<dossier contenant surge-media-core.tgz> (la CI y passe
# celui qu'elle publie sur npm : même artefact partout, et aucune build Nuxt par architecture).
# Une seule image pour SQLite, PostgreSQL et MySQL/MariaDB : les trois clients Prisma sont embarqués et le
# serveur charge celui de DATABASE_PROVIDER (déduit de DATABASE_URL s'il manque). Guide : setup.md, § 4.

ARG NODE_VERSION=24
# Debian 13 « trixie » : ffmpeg 7.1 (Debian 12 « bookworm » n'a que ffmpeg 5.1, refusé par surgeMedia).
ARG DEBIAN_RELEASE=trixie

# ─── Build : dépendances, clients Prisma, serveur Nuxt, paquet npm ──────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS build

# Compilation des modules natifs sans binaire précompilé (better-sqlite3) ; openssl : moteur de Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates g++ make openssl python3 \
 && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=4096
RUN corepack enable

WORKDIR /src

# Paquets téléchargés d'après le seul fichier de verrouillage : couche réutilisée tant qu'il ne change pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=surge-media-pnpm,target=/pnpm-store \
    pnpm fetch --store-dir /pnpm-store

# Sources des applications seulement : modifier docker/ ou la documentation ne relance pas la build. Quand le core
# dépendra d'une bibliothèque de packages/ (vue, react, svelte…), ajouter : COPY packages ./packages
COPY apps ./apps
# L'installation lance `nuxt prepare` et la génération des trois clients Prisma (script `prepare`).
RUN --mount=type=cache,id=surge-media-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm-store
RUN pnpm --filter @surge-media/core build
# `pack` lance scripts/prepack.ts : modules natifs retirés, liens remplacés par des copies, licence ajoutée.
COPY LICENSE ./
RUN cd apps/core && pnpm pack --out /surge-media-core.tgz

# ─── Paquet à installer : celui de la build, ou --build-context package=<dossier> ───────────────────────────
FROM scratch AS package
COPY --from=build /surge-media-core.tgz /

# ─── Installation du paquet : modules natifs de la plateforme cible, CLI Prisma des migrations ──────────────
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS install

# Compilation de secours des modules natifs ; openssl présent : Prisma télécharge le moteur qui lui correspond.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates g++ make openssl python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# npm 12 et plus n'exécutent les scripts d'installation des dépendances qu'une fois approuvés : ceux qu'il faut
# le sont d'avance (champ ignoré par npm 11).
RUN printf '%s\n' '{"private":true,"allowScripts":{"better-sqlite3":true,"@prisma/engines":true,"prisma":true}}' > package.json
RUN --mount=type=bind,from=package,target=/package \
    npm install --omit=dev --no-audit --no-fund --no-package-lock /package/surge-media-core.tgz
# Échec de la build plutôt qu'un conteneur qui démarre sans pilote SQLite, sharp ou argon2.
RUN node -e "const D = require('better-sqlite3'); new D(':memory:').close(); require('sharp'); require('@node-rs/argon2')"

# ─── Image sans ffmpeg ──────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS slim

# tini : PID 1 qui relaie les signaux (arrêt propre) ; openssl : moteur de migration de Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/*

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="surgeMedia" \
      org.opencontainers.image.description="Self-hosted platform to manage, transform and deliver media" \
      org.opencontainers.image.source="https://github.com/mahmoud-nb/surge-media" \
      org.opencontainers.image.documentation="https://github.com/mahmoud-nb/surge-media/blob/main/setup.md" \
      org.opencontainers.image.licenses="BUSL-1.1" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    PORT=3000 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

WORKDIR /app

# Fichiers en lecture seule pour l'utilisateur `node` ; seul /app/data (base SQLite, médias, secrets) lui
# appartient.
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/node_modules/@surge-media/core/LICENSE ./LICENSE
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/surge-media-entrypoint
RUN mkdir -p /app/data && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--", "surge-media-entrypoint"]
CMD ["server"]

# ─── Image complète, avec ffmpeg (par défaut) ───────────────────────────────────────────────────────────────
FROM slim AS full

USER root
# ffmpeg 7.1 de Debian (libx264, AAC, SVT-AV1, Opus) ; prlimit (util-linux) est déjà présent.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
USER node
