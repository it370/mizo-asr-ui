import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SECONDS = 30;

function wavDurationSeconds(b64: string): number | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 44) return null;
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const bitsPerSample = buf.readUInt16LE(34);
    const dataSize = buf.readUInt32LE(40);
    const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
    if (!bytesPerSecond) return null;
    return dataSize / bytesPerSecond;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const adminUrl = process.env.ASR_ADMIN_URL?.replace(/\/$/, "");
  const adminKey = process.env.ASR_ADMIN_API_KEY;
  if (!adminUrl || !adminKey) {
    return NextResponse.json({ error: "Corrections are not available right now." }, { status: 500 });
  }

  let audio: unknown;
  let text: unknown;
  try {
    ({ audio, text } = await request.json());
  } catch {
    return NextResponse.json({ error: "We could not read that correction." }, { status: 400 });
  }

  const cleaned = typeof text === "string" ? text.trim() : "";
  if (!cleaned) {
    return NextResponse.json({ error: "Please enter a transcription." }, { status: 400 });
  }
  if (typeof audio !== "string" || !audio) {
    return NextResponse.json({ error: "Please keep the audio clip and try again." }, { status: 400 });
  }

  const duration = wavDurationSeconds(audio);
  if (duration === null || duration <= 0 || duration > MAX_SECONDS + 0.4) {
    return NextResponse.json({ error: `Please keep clips under ${MAX_SECONDS} seconds.` }, { status: 400 });
  }

  const wav = Buffer.from(audio, "base64");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "clip.wav");
  form.append("text", cleaned);

  let upstream: Response;
  try {
    upstream = await fetch(`${adminUrl}/api/contribute`, {
      method: "POST",
      headers: { "x-api-key": adminKey },
      body: form,
      signal: AbortSignal.timeout(50_000),
    });
  } catch {
    return NextResponse.json({ error: "We could not send that correction. Please try again." }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: "We could not send that correction. Please try again." }, { status: upstream.status === 401 ? 502 : upstream.status });
  }

  return NextResponse.json({ ok: true });
}
