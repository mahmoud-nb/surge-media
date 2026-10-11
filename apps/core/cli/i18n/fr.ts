/**
 * Messages de la CLI — français (langue par défaut et référence).
 * Toute clé ajoutée ici doit l'être aussi dans en.ts (vérifié par le typage).
 */
export const fr = {
  'cli.description': 'Outil d\'installation et d\'administration de surgeMedia',
  'args.lang': 'Langue de la CLI',
  'args.cwd': 'Dossier de l\'installation (.env et données) ; par défaut le dossier courant (apps/core dans le dépôt des sources)',
  'args.provider': 'Fournisseur de base de données',
  'args.url': 'URL de connexion à la base de données',
  'args.yes': 'Mode non interactif : accepte les valeurs par défaut sans confirmation',
  'args.skipMigrate': 'Configure la base sans appliquer les migrations',
  'args.siteUrl': 'URL publique de l\'installation (ex. https://media.example.com)',
  'args.port': 'Port du processus de travail (sonde /api/health seulement)',
  'args.startPort': 'Port du serveur web (par défaut : variable PORT, sinon 3000)',

  'command.init': 'Configure la base de données (fournisseur et URL) puis applique les migrations',
  'command.db': 'Gestion de la base de données',
  'command.db.migrate': 'Applique les migrations en attente (après une mise à jour)',
  'command.db.reset': 'Recrée la base, éventuellement avec un nouveau fournisseur (supprime toutes les données)',
  'command.start': 'Lance le serveur surgeMedia (administration, API, diffusion des médias)',
  'command.worker': 'Lance un processus de travail du traitement des vidéos (NUXT_VIDEO_PROCESSING=external)',

  'intro.init': 'surgeMedia · initialisation',
  'intro.migrate': 'surgeMedia · migrations',
  'intro.reset': 'surgeMedia · réinitialisation de la base',

  'config.current': 'Configuration actuelle : {provider} ({url})',
  'config.shellOverride': 'La variable {name} est définie dans votre environnement : elle reste prioritaire sur le fichier .env.',

  'prompt.provider': 'Quel fournisseur de base de données utiliser ?',
  'prompt.url': 'URL de connexion',
  'prompt.siteUrl': 'URL publique de surgeMedia (base des liens vers les médias)',
  'provider.sqlite.label': 'SQLite',
  'provider.sqlite.hint': 'fichier local, rien à installer (idéal pour démarrer)',
  'provider.postgresql.label': 'PostgreSQL',
  'provider.postgresql.hint': 'recommandé en production',
  'provider.mysql.label': 'MySQL / MariaDB',
  'provider.mysql.hint': 'MySQL 8+ ou MariaDB 10.6+',

  'summary.title': 'Récapitulatif',
  'summary.provider': 'Fournisseur',
  'summary.url': 'URL',
  'summary.siteUrl': 'URL publique',
  'summary.root': 'Dossier de l\'installation',

  'warn.providerChange': 'Changement de fournisseur ({from} → {to}) : les données existantes ne sont pas transférées.',
  'warn.reset': 'Toutes les tables et données de {url} vont être supprimées puis recréées.',

  'confirm.apply': 'Appliquer cette configuration ?',
  'confirm.reset': 'Confirmez-vous la suppression définitive des données ?',

  'step.env': 'Fichier .env mis à jour',
  'step.secretGenerated': 'Secret généré ({name})',
  'step.schema': 'Schéma Prisma configuré pour {provider}',
  'step.generate': 'Génération des clients Prisma (un par fournisseur)…',
  'step.generateDone': 'Clients Prisma générés',
  'step.generateUpToDate': 'Clients Prisma à jour',
  'step.migrate': 'Application des migrations…',
  'step.migrateDone': 'Migrations appliquées',
  'step.migrateSkipped': 'Migrations non appliquées (--skip-migrate)',
  'step.reset': 'Réinitialisation de la base…',
  'step.resetDone': 'Base recréée et migrations appliquées',
  'step.serverStarting': 'surgeMedia · serveur web (port {port}, Ctrl+C pour arrêter)',
  'step.workerStarting': 'surgeMedia · processus de travail du traitement des vidéos (port {port}, Ctrl+C pour arrêter)',

  'outro.init': 'Base de données prête. Démarrez surgeMedia avec « pnpm dev ».',
  'outro.initPackage': 'Base de données prête. Démarrez surgeMedia avec « npx surge-media start ».',
  'outro.migrate': 'Base de données à jour.',
  'outro.reset': 'Base de données réinitialisée.',
  'note.providerChanged': 'Fournisseur changé : redémarrez le serveur et les processus de travail (aucune reconstruction nécessaire).',

  'cancelled': 'Opération annulée.',
  'error.instanceInNodeModules': 'Lancez la commande depuis le dossier de votre installation, pas depuis node_modules ({path}) : ses données seraient effacées à la prochaine installation. Ou précisez-le avec --cwd.',
  'error.invalidProvider': 'Fournisseur « {value} » non supporté. Valeurs possibles : {providers}.',
  'error.urlRequired': 'L\'URL de connexion est obligatoire.',
  'error.siteUrl': 'L\'URL publique doit commencer par http:// ou https:// et ne contenir ni identifiants, ni paramètres, ni ancre.',
  'error.urlScheme': 'Pour {provider}, l\'URL doit commencer par {schemes}',
  'error.urlChars': 'L\'URL ne doit contenir ni guillemets ni retour à la ligne (encodez les caractères spéciaux, ex. %22).',
  'error.urlMissingNonInteractive': '--url est obligatoire pour {provider} en mode non interactif.',
  'error.notConfigured': 'Base de données non configurée : lancez d\'abord « surge-media init ».',
  'error.command': 'Échec de « {command} »',
  'error.buildMissing': 'Serveur construit introuvable ({path}) : lancez d\'abord « pnpm build ».',
  'error.invalidPort': 'Port « {value} » invalide (entier de 1 à 65535).',
  'error.processFailed': 'Impossible de lancer le serveur : {message}',
  'error.sqliteDriver': 'Pilote SQLite inutilisable ({message}) : son module natif n\'a pas été installé (npm 12 et plus, comme pnpm, bloquent les scripts d\'installation des dépendances). Lancez « npm install-scripts approve better-sqlite3 @prisma/engines » puis « npm rebuild better-sqlite3 » (pnpm : « pnpm approve-builds »).',
} as const

export type MessageKey = keyof typeof fr
