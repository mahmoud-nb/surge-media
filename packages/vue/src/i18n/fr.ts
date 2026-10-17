/**
 * Textes des composants en français (langue de référence et par défaut). Aucun texte n'est écrit en dur
 * dans les composants : libellés, annonces et `aria-label` passent par ces catalogues. Paramètres entre
 * accolades (`{name}`).
 */
export const fr = {
  video: {
    noSource: 'Cette vidéo sera lisible ici dès que sa version compatible sera prête.',
    unavailable: 'Cette vidéo ne peut pas être lue ici.',
    held: 'Cette vidéo est en cours de préparation : nouvel essai dans quelques instants.',
    unsupported: 'Votre navigateur ne peut pas lire cette vidéo.',
    download: 'Télécharger la vidéo originale',
    pause: 'Mettre la vidéo en pause',
    play: 'Lire la vidéo',
  },
  processing: {
    states: {
      pending: 'En attente de traitement',
      processing: 'Traitement en cours',
      ready: 'Vidéo prête',
      failed: 'Traitement interrompu',
    },
    progress: 'Avancement du traitement',
    announce: {
      started: 'Le traitement de la vidéo a commencé.',
      ready: 'La vidéo est prête.',
      failed: 'Le traitement de la vidéo n\'a pas pu aboutir.',
    },
    errors: {
      NO_VIDEO_TRACK: 'Le fichier ne contient pas d\'image vidéo.',
      UNREADABLE: 'Le fichier vidéo est illisible.',
      CONVERSION_FAILED: 'La conversion de la vidéo a échoué.',
      TOO_LONG: 'La vidéo dépasse la durée maximale de traitement.',
      TIMEOUT: 'Le traitement a pris trop de temps.',
      SOURCE_MISSING: 'Le fichier original est introuvable.',
      FFMPEG_UNAVAILABLE: 'Le traitement des vidéos est indisponible sur le serveur.',
    },
  },
  thumbnail: {
    duration: 'Durée : {duration}',
    kinds: {
      image: 'Image',
      video: 'Vidéo',
      other: 'Fichier',
    },
  },
  media: {
    download: 'Télécharger « {name} »',
  },
  upload: {
    choose: 'Choisir des fichiers',
    chooseOne: 'Choisir un fichier',
    drop: 'ou les déposer ici',
    dropOne: 'ou le déposer ici',
    help: {
      image: 'Images : {types}, {max} au plus.',
      video: 'Vidéos : {types}, {max} au plus.',
      converted: 'Vidéos converties après l\'envoi : {types}.',
      remaining: 'Envois restants : {count}.',
    },
    unavailable: 'L\'envoi de fichiers n\'est pas disponible.',
    visibility: {
      label: 'Visibilité',
      public: 'Public',
      private: 'Privé',
    },
    details: {
      title: 'Titre',
      altText: 'Texte alternatif',
      ofFile: '(« {name} »)',
      altHint: 'Décrivez l\'image pour les personnes qui ne la voient pas.',
      send: 'Envoyer les fichiers',
    },
    queue: 'Fichiers à envoyer',
    progress: 'Avancement de l\'envoi de « {name} »',
    status: {
      queued: 'En attente',
      retrying: 'Nouvel essai dans un instant',
      uploading: 'Envoi en cours : {percent}',
      poster: 'Envoi de l\'affiche',
      done: 'Envoyé',
      error: 'Échec',
      canceled: 'Annulé',
    },
    actions: {
      cancel: 'Annuler',
      cancelFile: 'Annuler l\'envoi de « {name} »',
      retry: 'Réessayer',
      retryFile: 'Réessayer l\'envoi de « {name} »',
      remove: 'Retirer',
      removeFile: 'Retirer « {name} » de la liste',
      clear: 'Retirer les fichiers terminés',
    },
    announce: {
      done: '« {name} » est envoyé.',
      error: 'Échec de l\'envoi de « {name} » : {message}',
      summary: 'Envois terminés. Réussis : {done}. En échec : {failed}.',
    },
  },
}

export type Messages = typeof fr
