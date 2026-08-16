import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Lambda inference timeout is 90s; keep a buffer under Vercel Hobby's 300s cap. */
export const maxDuration = 120;

const UPSTREAM_MS = 110_000;
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

function waitCopy(seconds: unknown) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "Please try again in a few minutes.";
  }
  if (seconds < 60) return "Please try again in less than a minute.";
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "Please try again in about 1 minute." : `Please try again in about ${minutes} minutes.`;
}

export async function POST(request: Request) {
  const url = process.env.LAMBDA_URL?.replace(/\/$/, "");
  const apiKey = process.env.LAMBDA_API_KEY;
  if (!url || !apiKey) {
    return NextResponse.json({ error: "The service is not available right now." }, { status: 500 });
  }

  let audio: unknown;
  try {
    ({ audio } = await request.json());
  } catch {
    return NextResponse.json({ error: "We could not read that recording." }, { status: 400 });
  }
  if (typeof audio !== "string" || !audio) {
    return NextResponse.json({ error: "Please record audio first." }, { status: 400 });
  }

  const duration = wavDurationSeconds(audio);
  const rawBytes = Buffer.from(audio, "base64").length;
  const tooLong = (duration !== null && duration > MAX_SECONDS + 0.4) || rawBytes > (MAX_SECONDS + 2) * 16000 * 2;
  if (tooLong) {
    return NextResponse.json({ error: `Please keep clips under ${MAX_SECONDS} seconds.` }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ audio_b64: audio }),
      signal: AbortSignal.timeout(UPSTREAM_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return NextResponse.json(
      { error: timedOut ? "This is taking too long. Please try again." : "We could not complete that request. Please try again." },
      { status: timedOut ? 504 : 502 }
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed = await upstream.json();
    if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We could not complete that request. Please try again." }, { status: 502 });
  }

  if (payload.status === "warming_up") {
    const retry_seconds = typeof payload.eta_seconds === "number" ? payload.eta_seconds : null;
    return NextResponse.json({ message: waitCopy(retry_seconds), retry_seconds });
  }

  if (upstream.status === 401) {
    return NextResponse.json({ error: "We could not process this request. Please try again." }, { status: 401 });
  }

  const text = typeof payload.transcription === "string" ? payload.transcription : "";
  if (upstream.ok && text) {
    return NextResponse.json({ text });
  }

  return NextResponse.json(
    { error: "We could not transcribe that clip. Please try again." },
    { status: upstream.ok ? 502 : upstream.status }
  );
}
