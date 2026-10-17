import type { Messages } from './fr'

/** Textes des composants en anglais (mêmes clés que le français, vérifiées par le typage). */
export const en: Messages = {
  video: {
    noSource: 'This video will play here as soon as its compatible version is ready.',
    unavailable: 'This video cannot be played here.',
    held: 'This video is being prepared: trying again in a moment.',
    unsupported: 'Your browser cannot play this video.',
    download: 'Download the original video',
    pause: 'Pause the video',
    play: 'Play the video',
  },
  processing: {
    states: {
      pending: 'Waiting for processing',
      processing: 'Processing',
      ready: 'Video ready',
      failed: 'Processing stopped',
    },
    progress: 'Processing progress',
    announce: {
      started: 'Video processing has started.',
      ready: 'The video is ready.',
      failed: 'Video processing could not be completed.',
    },
    errors: {
      NO_VIDEO_TRACK: 'The file contains no video image.',
      UNREADABLE: 'The video file cannot be read.',
      CONVERSION_FAILED: 'The video conversion failed.',
      TOO_LONG: 'The video exceeds the maximum processing duration.',
      TIMEOUT: 'Processing took too long.',
      SOURCE_MISSING: 'The original file cannot be found.',
      FFMPEG_UNAVAILABLE: 'Video processing is unavailable on the server.',
    },
  },
  thumbnail: {
    duration: 'Duration: {duration}',
    kinds: {
      image: 'Image',
      video: 'Video',
      other: 'File',
    },
  },
  media: {
    download: 'Download “{name}”',
  },
  upload: {
    choose: 'Choose files',
    chooseOne: 'Choose a file',
    drop: 'or drop them here',
    dropOne: 'or drop it here',
    help: {
      image: 'Images: {types}, {max} at most.',
      video: 'Videos: {types}, {max} at most.',
      converted: 'Videos converted after upload: {types}.',
      remaining: 'Uploads left: {count}.',
    },
    unavailable: 'File upload is not available.',
    visibility: {
      label: 'Visibility',
      public: 'Public',
      private: 'Private',
    },
    details: {
      title: 'Title',
      altText: 'Alternative text',
      ofFile: '(“{name}”)',
      altHint: 'Describe the image for people who cannot see it.',
      send: 'Upload files',
    },
    queue: 'Files to upload',
    progress: 'Upload progress of “{name}”',
    status: {
      queued: 'Waiting',
      retrying: 'Trying again in a moment',
      uploading: 'Uploading: {percent}',
      poster: 'Uploading the poster',
      done: 'Uploaded',
      error: 'Failed',
      canceled: 'Canceled',
    },
    actions: {
      cancel: 'Cancel',
      cancelFile: 'Cancel the upload of “{name}”',
      retry: 'Retry',
      retryFile: 'Retry the upload of “{name}”',
      remove: 'Remove',
      removeFile: 'Remove “{name}” from the list',
      clear: 'Remove finished files',
    },
    announce: {
      done: '“{name}” is uploaded.',
      error: 'Upload of “{name}” failed: {message}',
      summary: 'Uploads finished. Succeeded: {done}. Failed: {failed}.',
    },
  },
}
