# syntax=docker/dockerfile:1.7
#
# surgeMedia — image du core : administration, API, diffusion et traitement des médias.
#
#   docker build -t surge-media .                     image complète, avec ffmpeg (cible « full », par défaut)
#   docker build --target slim -t surge-media:slim .  sans ffmpeg (traitement des vidéos impossible)
#
# Une seule image pour SQLite, PostgreSQL et MySQL/MariaDB : les trois clients Prisma sont embarqués et le
# serveur charge celui de DATABASE_PROVIDER (déduit de DATABASE_URL s'il manque). Guide : setup.md, § 12.2.

ARG NODE_VERSION=24
# Debian 13 « trixie » : ffmpeg 7.1 (Debian 12 « bookworm » n'a que ffmpeg 5.1, refusé par surgeMedia).
ARG DEBIAN_RELEASE=trixie

# ─── Build : dépendances, clients Prisma, serveur Nuxt ──────────────────────────────────────────────────────
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

# Sources des paquets seulement : modifier docker/, la documentation ou la licence ne relance pas la build.
COPY packages ./packages
# L'installation lance `nuxt prepare` et la génération des trois clients Prisma (postinstall).
RUN --mount=type=cache,id=surge-media-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm-store
RUN pnpm --filter @surge-media/core build

# ─── CLI Prisma seule, pour appliquer les migrations au démarrage ───────────────────────────────────────────
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS prisma

# openssl présent à l'installation : Prisma télécharge le moteur de migration compilé pour cette version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/prisma
COPY packages/core/package.json /tmp/core-package.json
# Même version que le core (épinglée dans son package.json).
RUN version="$(node -p "require('/tmp/core-package.json').dependencies.prisma")" \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock "prisma@${version}"

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
COPY --from=prisma /opt/prisma/node_modules ./node_modules
COPY --from=build /src/packages/core/.output ./.output
COPY --from=build /src/packages/core/prisma/migrations ./prisma/migrations
COPY --from=build /src/packages/core/server/generated/schemas ./prisma/schemas
COPY --from=build /src/packages/core/prisma.config.ts ./
COPY --from=build /src/packages/core/shared/database.ts ./shared/database.ts
COPY LICENSE ./
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
