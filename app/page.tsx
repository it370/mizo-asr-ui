"use client";

import { useEffect, useRef, useState } from "react";
import { blobToWav16k } from "@/lib/wav";

const MAX_SECONDS = 10;

type Mode = "idle" | "recording" | "ready" | "working";

function formatClock(total: number) {
  const s = Math.max(0, Math.floor(total));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [clipSeconds, setClipSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [eta, setEta] = useState<number | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wavCacheRef = useRef<{ key: Blob; base64: string; duration: number } | null>(null);
  const audioUrlRef = useRef("");
  const startedAtRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    return () => {
      stopRecording(true);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (eta === null) return;
    if (eta <= 0) return;
    const id = window.setInterval(() => {
      setEta((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [eta !== null]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopRecording(discard = false) {
    clearTimer();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
    stopStream();
    if (discard) {
      chunksRef.current = [];
    }
  }

  async function startRecording() {
    if (busyRef.current || recorderRef.current) return;
    setError("");
    setNotice("");
    setEta(null);
    setText("");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow the mic in the browser and try again.");
      return;
    }
    if (busyRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    rec.onstop = () => {
      const recorded = Math.min(MAX_SECONDS, (Date.now() - startedAtRef.current) / 1000);
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) {
        keepAudio(blob, recorded);
      } else {
        setClipSeconds(0);
        setMode("idle");
      }
      stopStream();
    };
    recorderRef.current = rec;
    rec.start(200);
    startedAtRef.current = Date.now();
    setElapsed(0);
    setClipSeconds(0);
    setMode("recording");
    timerRef.current = window.setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      setElapsed(Math.min(MAX_SECONDS, seconds));
      if (seconds >= MAX_SECONDS) stopRecording();
    }, 100);
  }

  function keepAudio(blob: Blob, seconds: number) {
    wavCacheRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudio(blob);
    setAudioUrl(url);
    setClipSeconds(Math.min(MAX_SECONDS, seconds));
    setMode("ready");
  }

  async function wavFor(blob: Blob) {
    if (wavCacheRef.current?.key === blob) return wavCacheRef.current;
    const converted = await blobToWav16k(blob);
    wavCacheRef.current = { key: blob, ...converted };
    return wavCacheRef.current;
  }

  async function transcribe() {
    if (!audio || busyRef.current || recorderRef.current) return;
    busyRef.current = true;
    setMode("working");
    setError("");
    setNotice("");
    setEta(null);
    try {
      const { base64, duration } = await wavFor(audio);
      if (duration > MAX_SECONDS) {
        setError(`That clip is over ${MAX_SECONDS} seconds. Please record again.`);
        setAudio(null);
        setAudioUrl("");
        setClipSeconds(0);
        if (audioUrlRef.current) {
          URL.revokeObjectURL(audioUrlRef.current);
          audioUrlRef.current = "";
        }
        setMode("idle");
        return;
      }
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64 }),
      });
      const raw = await response.text();
      let payload: { message?: string; retry_seconds?: number | null; text?: string; error?: string } = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        setError("This is taking too long. Please try again.");
        setMode("ready");
        return;
      }
      if (typeof payload.retry_seconds === "number" || payload.message) {
        setNotice(payload.message || "Please try again in a few minutes.");
        if (typeof payload.retry_seconds === "number") setEta(payload.retry_seconds);
        setMode("ready");
        return;
      }
      if (!response.ok) {
        setError(payload.error || "We could not transcribe that clip. Please try again.");
        setMode("ready");
        return;
      }
      const result = payload.text || "";
      if (!result) {
        setError(payload.error || "We could not hear enough speech. Please record again.");
        setMode("ready");
        return;
      }
      setText(result);
      setMode("ready");
    } catch {
      setError("We could not complete that request. Please try again.");
      setMode("ready");
    } finally {
      busyRef.current = false;
    }
  }

  const busy = mode === "working";
  const recording = mode === "recording";
  const shownSeconds = recording ? elapsed : clipSeconds;
  const hint = busy
    ? "Transcription in progress."
    : recording
      ? `Recording will stop at ${MAX_SECONDS} seconds.`
      : `Speak Mizo into the microphone. Up to ${MAX_SECONDS} seconds.`;

  return (
    <main className="page">
      <header className="top">
        <h1>
          Speech to text
          <span className="mizo">Aw leh thusawi ziak chhuahna</span>
        </h1>
        <p className="meta">Mizo ṭawng · up to {MAX_SECONDS} seconds</p>
      </header>

      <section className="panel">
        <div className="stage">
          <div className="mic-wrap">
            <button
              className={`mic${recording ? " recording" : ""}`}
              type="button"
              disabled={busy}
              onClick={() => (recording ? stopRecording() : startRecording())}
              aria-label={recording ? "Stop recording" : "Start recording"}
            >
              {recording ? (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="7" y="7" width="10" height="10" rx="1.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z" />
                </svg>
              )}
            </button>
          </div>

          <div className="controls">
            <h2>{busy ? "Transcribing" : recording ? "Listening" : audioUrl ? "Recording ready" : "Record"}</h2>
            <p className="hint">{hint}</p>
            <div className="row">
              <button className="btn" type="button" disabled={busy} onClick={() => (recording ? stopRecording() : startRecording())}>
                {recording ? "Stop" : audioUrl ? "Record again" : "Record"}
              </button>
              <button className="btn primary" type="button" disabled={!audio || busy || recording} onClick={transcribe}>
                {busy ? "Transcribing…" : text || notice ? "Transcribe again" : "Transcribe"}
              </button>
              <span className="timer">
                {formatClock(shownSeconds)} / {formatClock(MAX_SECONDS)}
              </span>
            </div>
            {audioUrl && !recording ? (
              <div className={`player${busy ? " locked" : ""}`}>
                <span className="player-label">Recorded</span>
                <audio controls={!busy} src={audioUrl} preload="metadata" />
              </div>
            ) : null}
          </div>
        </div>

        {notice ? (
          <div className="banner warm">
            {notice}
            {eta !== null && eta > 0 ? ` About ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, "0")} left.` : ""}
          </div>
        ) : null}
        {error ? <div className="banner err">{error}</div> : null}

        <div className="out">
          <div className="out-head">
            <span>Transcription</span>
            <button className="btn" type="button" disabled={!text || busy} onClick={() => navigator.clipboard.writeText(text)}>
              Copy
            </button>
          </div>
          <div className={`transcript${text ? "" : " empty"}`}>
            {text || "Mizo text will appear here."}
          </div>
        </div>
      </section>
    </main>
  );
}
