"use client";

import { useEffect, useRef, useState } from "react";
import { blobToWav16k } from "@/lib/wav";

const MAX_SECONDS = 30;

type Mode = "idle" | "recording" | "ready" | "working";

export default function HomePage() {
  const [mode, setMode] = useState<Mode>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [text, setText] = useState("");
  const [warm, setWarm] = useState("");
  const [eta, setEta] = useState<number | null>(null);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wavCacheRef = useRef<{ key: Blob; base64: string; duration: number } | null>(null);
  const audioUrlRef = useRef("");

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
    setError("");
    setWarm("");
    setEta(null);
    setText("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const rec = new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) {
        keepAudio(blob);
      } else {
        setMode("idle");
      }
      stopStream();
    };
    recorderRef.current = rec;
    rec.start();
    setElapsed(0);
    setMode("recording");
    timerRef.current = window.setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= MAX_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
  }

  function keepAudio(blob: Blob) {
    wavCacheRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudio(blob);
    setAudioUrl(url);
    setMode("ready");
  }

  async function wavFor(blob: Blob) {
    if (wavCacheRef.current?.key === blob) return wavCacheRef.current;
    const converted = await blobToWav16k(blob);
    wavCacheRef.current = { key: blob, ...converted };
    return wavCacheRef.current;
  }

  async function transcribe() {
    if (!audio) return;
    setMode("working");
    setError("");
    setWarm("");
    setEta(null);
    try {
      const { base64, duration } = await wavFor(audio);
      if (duration > MAX_SECONDS) {
        setError(`Audio is ${duration.toFixed(1)}s. Keep clips under ${MAX_SECONDS} seconds.`);
        setMode("ready");
        return;
      }
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_b64: base64 }),
      });
      const payload = await response.json();
      if (response.status === 401) {
        setError("The transcription service rejected the request.");
        setMode("ready");
        return;
      }
      if (payload?.status === "warming_up") {
        setWarm(payload.message || "The system is warming up. Please try again shortly.");
        if (typeof payload.eta_seconds === "number") setEta(payload.eta_seconds);
        setMode("ready");
        return;
      }
      if (!response.ok) {
        setError(payload.error || `Transcription failed (HTTP ${response.status}).`);
        setMode("ready");
        return;
      }
      const result = payload.transcription || payload.message || "";
      if (!result) {
        setError(payload.error || "Empty transcription.");
        setMode("ready");
        return;
      }
      setText(result);
      setMode("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setMode("ready");
    }
  }

  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <main className="page">
      <header className="top">
        <div>
          <p className="eyebrow">Mizo language · Mizo ṭawng</p>
          <h1>
            Speech to text
            <span className="mizo">Aw leh thusawi ziak chhuahna</span>
          </h1>
        </div>
        <p className="meta">Wav2Vec2 + KenLM. Record up to 30 seconds. First request after idle may need a few minutes to warm.</p>
      </header>

      <section className="panel">
        <div className="stage">
          <div className="mic-wrap">
            <button
              className={`mic${mode === "recording" ? " recording" : ""}`}
              type="button"
              disabled={mode === "working"}
              onClick={() => (mode === "recording" ? stopRecording() : startRecording())}
              aria-label={mode === "recording" ? "Stop recording" : "Start recording"}
            >
              {mode === "recording" ? (
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
            <h2>{mode === "recording" ? "Listening" : audioUrl ? "Recording ready" : "Record"}</h2>
            <p className="hint">Speak Mizo into the microphone. Maximum 30 seconds.</p>
            <div className="row">
              <button className="btn" type="button" disabled={mode === "working"} onClick={() => (mode === "recording" ? stopRecording() : startRecording())}>
                {mode === "recording" ? "Stop" : audioUrl ? "Record again" : "Record"}
              </button>
              <button className="btn primary" type="button" disabled={!audio || mode === "working" || mode === "recording"} onClick={transcribe}>
                {mode === "working" ? "Transcribing…" : text || warm ? "Transcribe again" : "Transcribe"}
              </button>
              <span className="timer">{mode === "recording" ? clock : "00:00"} / 00:30</span>
            </div>
            {audioUrl && mode !== "recording" ? (
              <div className="player">
                <span className="player-label">Recorded</span>
                <audio controls src={audioUrl} preload="metadata" />
              </div>
            ) : null}
          </div>
        </div>

        {warm ? (
          <div className="banner warm">
            {warm}
            {eta !== null ? ` Remaining ${Math.floor(eta / 60)}:${String(eta % 60).padStart(2, "0")}.` : ""}
          </div>
        ) : null}
        {error ? <div className="banner err">{error}</div> : null}

        <div className="out">
          <div className="out-head">
            <span>Transcription</span>
            <button className="btn" type="button" disabled={!text} onClick={() => navigator.clipboard.writeText(text)}>
              Copy
            </button>
          </div>
          <div className={`transcript${text ? "" : " empty"}`}>
            {text || "Mizo text will appear here."}
          </div>
        </div>
      </section>

      <p className="foot">Audio is sent as 16 kHz mono WAV to the transcription service. Do not send a second request while the first is still running.</p>
    </main>
  );
}
