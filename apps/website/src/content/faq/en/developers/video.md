---
question: "What does surgeMedia do with videos?"
order: 6
status: partial
keywords: ["video","ffmpeg","h264","av1","hls","streaming","subtitles","poster"]
---
On upload, it prepares MP4 and MOV files for instant playback and strips location and device data. It handles poster images and subtitles (WebVTT or SRT).

With FFmpeg enabled, it converts unplayable formats (MKV, AVI…), produces H.264 and AV1 renditions and removes the GPS tracks of action cameras, in separate processes. Adaptive streaming (HLS) is not available yet: it is planned.
