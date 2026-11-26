/**
 * Prepares large sermon recordings (e.g., 3.2 GB camera MP4 or uncompressed WAV)
 * in the browser before upload by downmixing to 16 kHz mono speech WAV when <= 450 MB,
 * shrinking bandwidth by 80-95% while keeping Whisper's native 16 kHz sample rate.
 */
const TARGET_RATE = 16000;
const COMPRESS_THRESHOLD_BYTES = 80 * 1024 * 1024; // 80 MB
const MAX_IN_MEMORY_BYTES = 450 * 1024 * 1024;     // safe browser ArrayBuffer ceiling

function encodeMonoWav(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function shouldCompress(file) {
  if (!file) return false;
  if (file.size < COMPRESS_THRESHOLD_BYTES) return false;
  if (/\.(ogg|opus|amr)$/i.test(file.name) && file.size < 150 * 1024 * 1024) return false;
  return true;
}

export async function prepareAudioFile(file, onStatus) {
  if (!shouldCompress(file) || file.size > MAX_IN_MEMORY_BYTES) {
    return file;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AudioCtx || !OfflineCtx) return file;

  let ctx;
  try {
    onStatus?.("Reading audio track in browser…");
    const raw = await file.arrayBuffer();
    ctx = new AudioCtx();
    const decoded = await ctx.decodeAudioData(raw);
    const frameCount = Math.ceil(decoded.duration * TARGET_RATE);
    if (!frameCount || frameCount <= 0) return file;

    onStatus?.("Optimizing audio for speech (16 kHz mono)…");
    const offline = new OfflineCtx(1, frameCount, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const wavBlob = encodeMonoWav(rendered.getChannelData(0), TARGET_RATE);

    if (wavBlob.size >= file.size * 0.9) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "sermon";
    return new File([wavBlob], `${baseName}.wav`, { type: "audio/wav", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    if (ctx && ctx.state !== "closed") {
      ctx.close().catch(() => {});
    }
  }
}
