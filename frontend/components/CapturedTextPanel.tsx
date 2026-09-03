"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Annotation, OcrStatus } from "@/lib/types";
import styles from "./CapturedTextPanel.module.css";

interface CapturedTextPanelProps {
  // Every annotation on the current page (ignore + capture) — filtered to
  // `capture` inside this component; `ignore` rectangles never appear here.
  annotations: Annotation[];
  // The annotation currently selected on the canvas (select mode), so the
  // matching entry can highlight itself — this is the "clicking a rectangle
  // focuses its entry" half of the two-way link.
  selectedId: string | null;
  // The other half: clicking an entry asks the canvas to select + flash the
  // matching rectangle.
  onFocusAnnotation: (id: string) => void;
  onSaveOcrText: (id: string, text: string) => Promise<void>;
}

const STATUS_LABEL: Record<OcrStatus, string> = {
  pending: "Pending",
  done: "Done",
  empty: "Empty",
  failed: "Failed",
};

function StatusBadge({ status }: { status: OcrStatus | null }) {
  const label = status ? STATUS_LABEL[status] : "Not run yet";
  const cls =
    status === "done"
      ? styles.badgeDone
      : status === "empty"
      ? styles.badgeEmpty
      : status === "failed"
      ? styles.badgeFailed
      : status === "pending"
      ? styles.badgePending
      : styles.badgeNone;
  return <span className={`${styles.badge} ${cls}`}>{label}</span>;
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const cls = pct >= 80 ? styles.badgeDone : pct >= 50 ? styles.badgePending : styles.badgeFailed;
  return <span className={`${styles.badge} ${cls}`}>{pct}% confidence</span>;
}

function CapturedTextRow({
  annotation,
  index,
  isSelected,
  onFocusAnnotation,
  onSaveOcrText,
}: {
  annotation: Annotation;
  index: number;
  isSelected: boolean;
  onFocusAnnotation: (id: string) => void;
  onSaveOcrText: (id: string, text: string) => Promise<void>;
}) {
  const [text, setText] = useState(annotation.ocr_text ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  // Adopt server text whenever it changes (e.g. an OCR run just wrote it,
  // or another tab corrected it) — but never while the user has an unsaved
  // local edit in progress, so a background reload can't stomp on what
  // they're typing. Done as a render-time adjustment (comparing against
  // the last-seen server value) rather than an effect, matching
  // DrawingViewer's jump-to-page sync — this is a pure derivation from
  // props, so it doesn't need an effect's extra commit-then-rerender pass.
  const [lastServerText, setLastServerText] = useState(annotation.ocr_text);
  if (lastServerText !== annotation.ocr_text) {
    setLastServerText(annotation.ocr_text);
    if (!dirty) setText(annotation.ocr_text ?? "");
  }

  useEffect(() => {
    if (isSelected) rowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isSelected]);

  async function handleBlur() {
    if (!dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveOcrText(annotation.id, text);
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save correction");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      ref={rowRef}
      className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(index, 8) * 0.02 }}
    >
      <button
        type="button"
        className={styles.rowHeader}
        onClick={() => onFocusAnnotation(annotation.id)}
        aria-label={`Jump to capture box ${index + 1} on the drawing`}
      >
        <span className={styles.rowTitle}>Box {index + 1}</span>
        <StatusBadge status={annotation.ocr_status} />
        <ConfidenceBadge confidence={annotation.ocr_confidence} />
      </button>

      <textarea
        className={styles.textarea}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={handleBlur}
        placeholder={
          annotation.ocr_status === null
            ? "Run OCR to extract text from this box…"
            : "(no text captured)"
        }
        rows={3}
        aria-label={`OCR text for box ${index + 1}`}
      />

      <div className={styles.rowFooter}>
        {saving && <span className={styles.savingNote}>Saving…</span>}
        {!saving && dirty && <span className={styles.savingNote}>Unsaved changes</span>}
        {saveError && <span className={styles.saveError}>{saveError}</span>}
        {annotation.ocr_engine && (
          <span className={styles.engineNote}>{annotation.ocr_engine}</span>
        )}
      </div>
    </motion.div>
  );
}

export default function CapturedTextPanel({
  annotations,
  selectedId,
  onFocusAnnotation,
  onSaveOcrText,
}: CapturedTextPanelProps) {
  const captures = annotations
    .filter((a) => a.type === "capture")
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  return (
    <div className={styles.wrapper}>
      <p className={styles.hint}>
        Captured (green) boxes on this page, in reading order. Text is auto-extracted — verify
        before it feeds into an estimate.
      </p>
      {captures.length === 0 ? (
        <p className={styles.empty}>
          No capture (green) boxes on this page yet. Draw one on the drawing to capture text.
        </p>
      ) : (
        <div className={styles.list}>
          {captures.map((a, i) => (
            <CapturedTextRow
              key={a.id}
              annotation={a}
              index={i}
              isSelected={selectedId === a.id}
              onFocusAnnotation={onFocusAnnotation}
              onSaveOcrText={onSaveOcrText}
            />
          ))}
        </div>
      )}
    </div>
  );
}
