"use client";

import { useEffect, useRef, useState } from "react";

/**
 * TEMPORARY — keep-alive ping so Lambda does not go cold.
 * Remove this file and every `TEMP_ZZ_LAMBDA_KEEPALIVE` mark in app/page.tsx.
 */
export const TEMP_ZZ_LAMBDA_KEEPALIVE_MS =
  (4.5 + Math.random() - 0.5) * 60 * 1000; // random between 3.5 and 5 minutes in ms

export function useTempZzLambdaKeepalive(opts: {
  enabled: boolean;
  resetKey: number;
  onFire: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(TEMP_ZZ_LAMBDA_KEEPALIVE_MS);
  const deadlineRef = useRef(Date.now() + TEMP_ZZ_LAMBDA_KEEPALIVE_MS);
  const onFireRef = useRef(opts.onFire);
  onFireRef.current = opts.onFire;

  useEffect(() => {
    deadlineRef.current = Date.now() + TEMP_ZZ_LAMBDA_KEEPALIVE_MS;
    setRemainingMs(TEMP_ZZ_LAMBDA_KEEPALIVE_MS);
  }, [opts.resetKey]);

  useEffect(() => {
    if (!opts.enabled) return;
    const id = window.setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) onFireRef.current();
    }, 250);
    return () => window.clearInterval(id);
  }, [opts.enabled]);

  return remainingMs;
}

export function TempZzLambdaKeepaliveChip({ remainingMs, visible }: { remainingMs: number; visible: boolean }) {
  if (!visible) return null;
  const total = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <div
      className="TEMP_ZZ_LAMBDA_KEEPALIVE"
      aria-hidden="true"
      style={{
        position: "fixed",
        right: "max(10px, env(safe-area-inset-right))",
        bottom: "max(10px, env(safe-area-inset-bottom))",
        zIndex: 20,
        fontVariantNumeric: "tabular-nums",
        fontSize: 11,
        letterSpacing: "0.04em",
        color: "#8a8378",
        background: "rgba(255, 253, 248, 0.92)",
        border: "1px solid #d8d0c4",
        borderRadius: 999,
        padding: "3px 8px",
        pointerEvents: "none",
      }}
    >
      {mm}:{ss}
    </div>
  );
}
