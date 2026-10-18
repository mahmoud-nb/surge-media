declare const process: { env: { NODE_ENV?: string } }

/**
 * Mode développement (avertissements des composants) : `process.env.NODE_ENV`, remplacé par l'outil de
 * build de l'application (jamais `import.meta.env` : figé au build d'une bibliothèque). Hors outil de build
 * (navigateur sans `process`) : faux.
 */
export const DEV_MODE: boolean = (() => {
  try {
    return process.env.NODE_ENV !== 'production'
  }
  catch {
    return false
  }
})()
