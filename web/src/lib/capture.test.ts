import { afterEach, expect, it, vi } from "vitest";
import { captureInputs } from "./capture";

function stream(audio = true) {
  const tracks = [
    { kind: "video", stop: vi.fn(), readyState: "live" },
    ...(audio ? [{ kind: "audio", stop: vi.fn(), readyState: "live" }] : []),
  ];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  } as unknown as MediaStream;
}
afterEach(() => vi.unstubAllGlobals());

it("requests only the microphone for microphone mode", async () => {
  const microphone = stream();
  const share = vi.fn();
  const mic = vi.fn().mockResolvedValue(microphone);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mic, getDisplayMedia: share },
  });
  expect(await captureInputs("microphone")).toEqual([microphone]);
  expect(mic).toHaveBeenCalledWith(
    expect.objectContaining({ video: false, audio: expect.any(Object) }),
  );
  expect(share).not.toHaveBeenCalled();
});

it("captures lecture audio without requesting a microphone", async () => {
  const lecture = stream();
  const mic = vi.fn();
  const share = vi.fn().mockResolvedValue(lecture);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: mic, getDisplayMedia: share },
  });
  expect(await captureInputs("lecture")).toEqual([lecture]);
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ audio: true, video: expect.any(Object) }),
  );
  expect(mic).not.toHaveBeenCalled();
});

it("retains both audio inputs for mixed recording", async () => {
  const lecture = stream(),
    microphone = stream();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(lecture),
      getUserMedia: vi.fn().mockResolvedValue(microphone),
    },
  });
  expect(await captureInputs("both")).toEqual([lecture, microphone]);
});

it("rejects a shared surface without audio and releases screen capture", async () => {
  const lecture = stream(false),
    mic = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(lecture),
      getUserMedia: mic,
    },
  });
  await expect(captureInputs("both")).rejects.toThrow(/audio/i);
  expect(lecture.getTracks()[0].stop).toHaveBeenCalled();
  expect(mic).not.toHaveBeenCalled();
});

it("releases the shared surface if microphone permission is denied", async () => {
  const lecture = stream();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: vi.fn().mockResolvedValue(lecture),
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    },
  });
  await expect(captureInputs("both")).rejects.toThrow(/microphone/i);
  lecture.getTracks().forEach((track) => expect(track.stop).toHaveBeenCalled());
});

it("does not silently record only the microphone when sharing is unsupported", async () => {
  const mic = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: mic } });
  await expect(captureInputs("both")).rejects.toThrow(/Chrome|Edge/);
  expect(mic).not.toHaveBeenCalled();
});
