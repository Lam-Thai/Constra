"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Annotation, DrawingDetail } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import AnnotationCanvas, { type FocusRequest } from "./AnnotationCanvas";
import Spinner from "./Spinner";
import styles from "./DrawingViewer.module.css";

// Purely cosmetic slide distance (px) for the page-change transition below —
// unrelated to the annotation overlay's normalized coordinate system, this
// only animates the page *container*, never a rectangle's position.
const SLIDE_DISTANCE = 24;

interface DrawingViewerProps {
  drawingId: string;
  // Page navigation is controlled from the parent (TakeoffWorkspace) so
  // sibling panels — the captured-text list and the estimate line items —
  // can jump the viewer to a specific page (click-to-source) without owning
  // a duplicate copy of "which page is showing" themselves.
  currentPage: number;
  onPageChange: (page: number) => void;
  onDrawingLoaded?: (drawing: DrawingDetail) => void;
  onAnnotationsChange?: (annotations: Annotation[]) => void;
  onSelectionChange?: (id: string | null) => void;
  focusRequest?: FocusRequest | null;
  reloadToken?: number;
}

export default function DrawingViewer({
  drawingId,
  currentPage,
  onPageChange,
  onDrawingLoaded,
  onAnnotationsChange,
  onSelectionChange,
  focusRequest,
  reloadToken,
}: DrawingViewerProps) {
  const [drawing, setDrawing] = useState<DrawingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState(String(currentPage));
  const [syncedPage, setSyncedPage] = useState(currentPage);
  // Direction of the most recent page change, purely to pick which side the
  // slide-in animation below enters from — not used for anything
  // coordinate-related. State (not a ref) because it's read during render.
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/drawings/${drawingId}/`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load drawing (${res.status})`);
        return res.json() as Promise<DrawingDetail>;
      })
      .then((data) => {
        if (!cancelled) {
          setDrawing(data);
          onDrawingLoaded?.(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load drawing");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawingId]);

  // Keep the jump-to-page input in sync when navigation happens elsewhere
  // (Prev/Next buttons) without stomping on in-progress typing. Adjusting
  // state during render (rather than in an effect) avoids an extra
  // commit-then-rerender pass for this.
  if (syncedPage !== currentPage) {
    setSyncedPage(currentPage);
    setJumpValue(String(currentPage));
  }

  if (error) {
    return <div className={`${styles.status} ${styles.statusError}`}>{error}</div>;
  }

  if (!drawing) {
    return (
      <div className={styles.status}>
        <span className={styles.statusInner}>
          <Spinner size={18} />
          Loading drawing…
        </span>
      </div>
    );
  }

  const totalPages = drawing.page_count;
  const page = drawing.pages.find((p) => p.page_number === currentPage);

  function goTo(n: number) {
    const clamped = Math.min(Math.max(n, 1), totalPages);
    setDirection(clamped >= currentPage ? 1 : -1);
    onPageChange(clamped);
  }

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(jumpValue);
    if (Number.isFinite(n)) goTo(Math.round(n));
    else setJumpValue(String(currentPage));
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>{drawing.name}</span>
        <div className={styles.pageNav}>
          <motion.button
            type="button"
            whileHover={currentPage > 1 ? { scale: 1.03 } : undefined}
            whileTap={currentPage > 1 ? { scale: 0.97 } : undefined}
            transition={{ duration: 0.12 }}
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            Prev
          </motion.button>
          <form className={styles.jumpForm} onSubmit={handleJumpSubmit}>
            <input
              className={styles.pageJumpInput}
              type="text"
              inputMode="numeric"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              aria-label="Jump to page"
            />
            <motion.button
              type="submit"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.12 }}
            >
              Go
            </motion.button>
          </form>
          <span className={styles.pageCount}>of {totalPages}</span>
          <motion.button
            type="button"
            whileHover={currentPage < totalPages ? { scale: 1.03 } : undefined}
            whileTap={currentPage < totalPages ? { scale: 0.97 } : undefined}
            transition={{ duration: 0.12 }}
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            Next
          </motion.button>
        </div>
      </div>

      <div className={styles.pageStage}>
        <AnimatePresence initial={false}>
          {page ? (
            <motion.div
              key={page.page_number}
              className={styles.pageSlide}
              initial={{ opacity: 0, x: SLIDE_DISTANCE * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -SLIDE_DISTANCE * direction }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <AnnotationCanvas
                drawingId={drawingId}
                page={page}
                onAnnotationsChange={onAnnotationsChange}
                onSelectionChange={onSelectionChange}
                focusRequest={focusRequest}
                reloadToken={reloadToken}
              />
            </motion.div>
          ) : (
            <motion.div
              key="missing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className={`${styles.pageSlide} ${styles.status}`}
            >
              Page {currentPage} not found.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
