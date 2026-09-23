export type RecordingSource = "microphone" | "lecture" | "both";

export async function captureInputs(
  source: RecordingSource,
): Promise<MediaStream[]> {
  const streams: MediaStream[] = [];
  let requesting = source === "microphone" ? "microphone" : "lecture audio";
  try {
    const devices = navigator.mediaDevices;
    if (source !== "microphone") {
      if (!devices?.getDisplayMedia)
        throw new Error(
          "Lecture audio is unavailable in this browser. Open LecNote in Chrome or Edge.",
        );
      const options: DisplayMediaStreamOptions & {
        selfBrowserSurface: string;
        systemAudio: string;
      } = {
        video: { displaySurface: "browser" },
        audio: true,
        selfBrowserSurface: "exclude",
        systemAudio: "include",
      };
      const lecture = await devices.getDisplayMedia(options);
      streams.push(lecture);
      if (
        !lecture.getAudioTracks().some((track) => track.readyState === "live")
      )
        throw new Error(
          "No lecture audio was shared. Select the lecture tab with audio sharing enabled.",
        );
    }
    if (source !== "lecture") {
      requesting = "microphone";
      if (!devices?.getUserMedia)
        throw new Error(
          "Microphone capture is unavailable. Open LecNote on localhost in Chrome or Edge.",
        );
      const microphone = await devices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      streams.push(microphone);
      if (
        !microphone
          .getAudioTracks()
          .some((track) => track.readyState === "live")
      )
        throw new Error(
          "No microphone audio is available. Check the selected input device.",
        );
    }
    if (
      streams.some((stream) =>
        stream.getTracks().some((track) => track.readyState === "ended"),
      )
    )
      throw new Error(
        "Audio sharing ended before recording started. Start again to select your sources.",
      );
    return streams;
  } catch (error) {
    streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError")
        throw new Error(
          `Access to ${requesting} was cancelled or blocked. Check browser and macOS permissions, then try again.`,
        );
      if (error.name === "NotFoundError")
        throw new Error(`No ${requesting} device is available.`);
      if (error.name === "NotReadableError")
        throw new Error(
          `The browser could not read ${requesting}. Check device availability and macOS privacy permissions.`,
        );
    }
    throw error;
  }
}
