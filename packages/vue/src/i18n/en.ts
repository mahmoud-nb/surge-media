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
}
