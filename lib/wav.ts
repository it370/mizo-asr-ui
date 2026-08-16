const TARGET_SR = 16000;

function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) {
      mono[i] += data[i] / channels;
    }
  }
  return mono;
}

async function resampleMono(samples: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return samples;
  const duration = samples.length / fromRate;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(duration * toRate)), toRate);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}

function toBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function blobToWav16k(
  blob: Blob,
  maxSeconds = 10
): Promise<{ base64: string; duration: number; sourceDuration: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const sourceDuration = decoded.duration;
    let mono = mixToMono(decoded);
    const maxSource = Math.floor(maxSeconds * decoded.sampleRate);
    if (mono.length > maxSource) mono = mono.subarray(0, maxSource);
    let resampled = await resampleMono(mono, decoded.sampleRate, TARGET_SR);
    const maxSamples = Math.floor(maxSeconds * TARGET_SR);
    if (resampled.length > maxSamples) resampled = resampled.subarray(0, maxSamples);
    const wav = encodeWavPcm16(resampled, TARGET_SR);
    return { base64: toBase64(wav), duration: resampled.length / TARGET_SR, sourceDuration };
  } finally {
    await ctx.close();
  }
}
