"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { OcrRunResult } from "@/lib/types";
import { runOcr } from "@/lib/api";
import Spinner from "./Spinner";
import styles from "./OcrControls.module.css";

type Scope = "page" | "drawing";

interface OcrControlsProps {
  drawingId: string;
  currentPage: number;
  // Called once a run completes successfully so the parent can refresh
  // whatever page-scoped state depends on the (now server-updated) ocr_*
  // fields — see AnnotationCanvas's `reloadToken` prop.
  onCompleted: (result: OcrRunResult, scope: Scope) => void;
}

function summarize(result: OcrRunResult): string {
  const parts: string[] = [];
  parts.push(`${result.processed} captured`);
  if (result.empty > 0) parts.push(`${result.empty} empty`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped (already done)`);
  return parts.join(", ");
}

export default function OcrControls({ drawingId, currentPage, onCompleted }: OcrControlsProps) {
  const [runningScope, setRunningScope] = useState<Scope | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ scope: Scope; data: OcrRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  async function handleRun(scope: Scope) {
    if (runningScope) return;
    setRunningScope(scope);
    setError(null);
    setResult(null);
    setProgress(6);

    // There's no real progress signal from a synchronous single-response
    // endpoint — this asymptotically approaches (never reaches) 92% while
    // the request is in flight, purely so the bar reads as "still working"
    // rather than stalled, then snaps to 100% on completion below.
    progressTimer.current = setInterval(() => {
      setProgress((p) => (p < 92 ? p + (92 - p) * 0.12 : p));
    }, 220);

    try {
      const data = await runOcr(drawingId, { page: scope === "page" ? currentPage : null, force });
      setResult({ scope, data });
      onCompleted(data, scope);
      setProgress(100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "OCR run failed — check your connection and try again."
      );
      setProgress(0);
    } finally {
      if (progressTimer.current) {
        clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
      setRunningScope(null);
      window.setTimeout(() => setProgress(0), 1000);
    }
  }

  const busy = runningScope !== null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.row}>
        <motion.button
          type="button"
          whileHover={busy ? undefined : { scale: 1.02 }}
          whileTap={busy ? undefined : { scale: 0.98 }}
          transition={{ duration: 0.12 }}
          className={styles.button}
          disabled={busy}
          onClick={() => handleRun("page")}
        >
          {runningScope === "page" ? (
            <span className={styles.buttonContent}>
              <Spinner size={13} />
              Running…
            </span>
          ) : (
            "Run OCR (this page)"
          )}
        </motion.button>
        <motion.button
          type="button"
          whileHover={busy ? undefined : { scale: 1.02 }}
          whileTap={busy ? undefined : { scale: 0.98 }}
          transition={{ duration: 0.12 }}
          className={styles.button}
          disabled={busy}
          onClick={() => handleRun("drawing")}
        >
          {runningScope === "drawing" ? (
            <span className={styles.buttonContent}>
              <Spinner size={13} />
              Running…
            </span>
          ) : (
            "Run OCR (whole drawing)"
          )}
        </motion.button>
        <label className={styles.forceLabel}>
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={busy}
          />
          Re-run already-processed boxes
        </label>
      </div>

      <AnimatePresence>
        {progress > 0 && (
          <motion.div
            className={styles.progressTrack}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              className={styles.progressFill}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            key="ocr-error"
            className={styles.errorBanner}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </motion.div>
        )}
        {result && (
          <motion.div
            key="ocr-result"
            className={styles.resultBanner}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            <span>
              {result.scope === "page" ? "This page: " : "Whole drawing: "}
              {summarize(result.data)}.
            </span>
            <button type="button" onClick={() => setResult(null)}>
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <p className={styles.note}>
        OCR text is auto-extracted locally — verify it before it feeds into an estimate.
      </p>
    </div>
  );
}
