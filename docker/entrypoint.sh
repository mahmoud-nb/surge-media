#!/bin/sh
# surgeMedia — point d'entrée de l'image Docker (setup.md, § 12.2).
#
#   server   (défaut) applique les migrations en attente puis lance le serveur web
#            (SURGE_MEDIA_MIGRATE=false : sans migration, par exemple pour une instance de plus)
#   worker   processus de travail du traitement des vidéos (NUXT_VIDEO_PROCESSING=external)
#   migrate  applique les migrations en attente puis s'arrête
#   …        toute autre commande est exécutée telle quelle (ex. : sh)
#
# Messages en français, ou en anglais avec SURGE_MEDIA_LANG=en.
set -eu

# /app : dossier de l'installation (données dans /app/data) ; le paquet npm est installé dans node_modules.
APP_DIR=/app
PACKAGE_DIR="$APP_DIR/node_modules/@surge-media/core"
SERVER="$PACKAGE_DIR/.output/server/index.mjs"
PRISMA="$APP_DIR/node_modules/prisma/build/index.js"
SECRETS_DIR="${SURGE_MEDIA_SECRETS_DIR:-$APP_DIR/data/secrets}"

# say "texte français" "English text"
say() {
  case "${SURGE_MEDIA_LANG:-fr}" in
    en*) printf '[surge-media] %s\n' "$2" >&2 ;;
    *) printf '[surge-media] %s\n' "$1" >&2 ;;
  esac
}

# Variables sensibles lisibles dans un fichier (secrets Docker) : NOM_FILE=/run/secrets/…
load_file_variables() {
  for name in DATABASE_URL NUXT_SESSION_PASSWORD NUXT_MEDIA_SIGNING_SECRET NUXT_MEDIA_PREVIOUS_SIGNING_SECRET \
    NUXT_MEDIA_STORAGE_S3_ACCESS_KEY_ID NUXT_MEDIA_STORAGE_S3_SECRET_ACCESS_KEY NUXT_SMTP_PASSWORD \
    NUXT_BOOTSTRAP_ADMIN_PASSWORD; do
    eval "file=\${${name}_FILE:-}"
    [ -n "$file" ] || continue
    eval "current=\${${name}:-}"
    if [ -n "$current" ]; then
      say "$name et ${name}_FILE sont tous deux définis : ${name}_FILE est ignoré." \
        "$name and ${name}_FILE are both set: ${name}_FILE is ignored."
    elif [ -r "$file" ]; then
      export "$name=$(cat "$file")"
    else
      say "${name}_FILE : fichier illisible ($file)." "${name}_FILE: unreadable file ($file)."
      exit 1
    fi
    unset "${name}_FILE"
  done
}

# DATABASE_PROVIDER déduit de DATABASE_URL s'il manque (postgres://, mysql://, file:), sinon SQLite.
detect_provider() {
  if [ -z "${DATABASE_PROVIDER:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
    case "$DATABASE_URL" in
      postgres://* | postgresql://*) DATABASE_PROVIDER=postgresql ;;
      mysql://*) DATABASE_PROVIDER=mysql ;;
      file:*) DATABASE_PROVIDER=sqlite ;;
    esac
  fi
  export DATABASE_PROVIDER="${DATABASE_PROVIDER:-sqlite}"
  case "$DATABASE_PROVIDER" in
    sqlite | postgresql | mysql) ;;
    *)
      say "DATABASE_PROVIDER=\"$DATABASE_PROVIDER\" n'est pas supporté (sqlite, postgresql ou mysql)." \
        "DATABASE_PROVIDER=\"$DATABASE_PROVIDER\" is not supported (sqlite, postgresql or mysql)."
      exit 1
      ;;
  esac
}

# Secret absent de l'environnement : lu dans le volume, ou généré une fois et conservé (jamais remplacé :
# cela déconnecterait tout le monde ou invaliderait les liens signés déjà partagés).
ensure_secret() {
  name=$1
  eval "current=\${${name}:-}"
  [ -z "$current" ] || return 0
  file="$SECRETS_DIR/$name"
  if [ ! -s "$file" ]; then
    if ! (umask 077 && mkdir -p "$SECRETS_DIR") 2>/dev/null; then
      say "Impossible d'écrire $SECRETS_DIR : définissez $name, ou rendez le volume accessible à l'utilisateur 1000." \
        "Cannot write $SECRETS_DIR: set $name, or make the volume writable by user 1000."
      exit 1
    fi
    tmp="$file.$$"
    (umask 077 && node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" >"$tmp")
    # Création atomique : si un autre conteneur l'a créé entre-temps, sa valeur est conservée.
    if ln "$tmp" "$file" 2>/dev/null; then
      say "$name généré et conservé dans $file (à sauvegarder avec les données)." \
        "$name generated and kept in $file (back it up with your data)."
    fi
    rm -f "$tmp"
  fi
  export "$name=$(cat "$file")"
}

migrate() {
  # Prisma est lancé depuis le paquet (prisma.config.ts, migrations du fournisseur) : un chemin SQLite relatif
  # l'est au dossier de l'installation, comme pour le serveur, d'où une URL absolue.
  url="${DATABASE_URL:-}"
  if [ "$DATABASE_PROVIDER" = sqlite ]; then
    path="${DATABASE_URL:-file:./data/surge-media.db}"
    path="${path#file:}"
    path="${path#//}"
    path="${path%%\?*}"
    case "$path" in
      /*) ;;
      *) path="$APP_DIR/${path#./}" ;;
    esac
    # SQLite crée le fichier, pas ses dossiers parents.
    mkdir -p "$(dirname "$path")"
    url="file:$path"
  fi
  say "Migrations de la base ($DATABASE_PROVIDER)…" "Database migrations ($DATABASE_PROVIDER)…"
  attempt=1
  while :; do
    if output=$(cd "$PACKAGE_DIR" && DATABASE_URL="$url" node "$PRISMA" migrate deploy \
      --schema "server/generated/schemas/$DATABASE_PROVIDER.prisma" 2>&1); then
      printf '%s\n' "$output" | grep -E '^(Applying migration|No pending migrations)' >&2 || true
      return 0
    fi
    # P1001 : base injoignable (encore en cours de démarrage ?) : nouvel essai, 20 au plus, toutes les 3 s.
    if printf '%s' "$output" | grep -q 'P1001' && [ "$attempt" -lt 20 ]; then
      say "Base injoignable, nouvel essai dans 3 s ($attempt/20)…" "Database unreachable, retrying in 3 s ($attempt/20)…"
      attempt=$((attempt + 1))
      sleep 3
      continue
    fi
    printf '%s\n' "$output" >&2
    say "Échec des migrations." "Migrations failed."
    exit 1
  done
}

cd "$APP_DIR"
command="${1:-server}"
case "$command" in
  server | worker | migrate) if [ $# -gt 0 ]; then shift; fi ;;
  *) exec "$@" ;;
esac

load_file_variables
detect_provider

case "$command" in
  migrate)
    migrate
    ;;
  server)
    ensure_secret NUXT_SESSION_PASSWORD
    ensure_secret NUXT_MEDIA_SIGNING_SECRET
    if [ "${SURGE_MEDIA_MIGRATE:-true}" != false ]; then migrate; fi
    exec node "$SERVER" "$@"
    ;;
  worker)
    ensure_secret NUXT_SESSION_PASSWORD
    ensure_secret NUXT_MEDIA_SIGNING_SECRET
    export NUXT_SERVER_ROLE=worker
    exec node "$SERVER" "$@"
    ;;
esac
