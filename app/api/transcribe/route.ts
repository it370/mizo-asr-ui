import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const url = process.env.LAMBDA_URL?.replace(/\/$/, "");
  const apiKey = process.env.LAMBDA_API_KEY;
  if (!url || !apiKey) {
    return NextResponse.json(
      { error: "Server is missing LAMBDA_URL or LAMBDA_API_KEY." },
      { status: 500 }
    );
  }

  let audio_b64: unknown;
  try {
    ({ audio_b64 } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof audio_b64 !== "string" || !audio_b64) {
    return NextResponse.json({ error: "Missing audio_b64." }, { status: 400 });
  }

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ audio_b64 }),
  });

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: `Unexpected response from transcription service (HTTP ${upstream.status}).` },
      { status: 502 }
    );
  }

  return NextResponse.json(payload, { status: upstream.status });
}
