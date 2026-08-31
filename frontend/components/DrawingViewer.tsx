"use client";

import { useEffect, useState } from "react";
import type { DrawingDetail } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import AnnotationCanvas from "./AnnotationCanvas";
import styles from "./DrawingViewer.module.css";

interface DrawingViewerProps {
  drawingId: string;
}

export default function DrawingViewer({ drawingId }: DrawingViewerProps) {
  const [drawing, setDrawing] = useState<DrawingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const [syncedPage, setSyncedPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/api/drawings/${drawingId}/`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load drawing (${res.status})`);
        return res.json() as Promise<DrawingDetail>;
      })
      .then((data) => {
        if (!cancelled) setDrawing(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load drawing");
      });
    return () => {
      cancelled = true;
    };
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
    return <div className={styles.status}>Loading drawing…</div>;
  }

  const totalPages = drawing.page_count;
  const page = drawing.pages.find((p) => p.page_number === currentPage);

  function goTo(n: number) {
    const clamped = Math.min(Math.max(n, 1), totalPages);
    setCurrentPage(clamped);
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
          <button type="button" onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1}>
            Prev
          </button>
          <form className={styles.jumpForm} onSubmit={handleJumpSubmit}>
            <input
              className={styles.pageJumpInput}
              type="text"
              inputMode="numeric"
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              aria-label="Jump to page"
            />
            <button type="submit">Go</button>
          </form>
          <span>
            of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            Next
          </button>
        </div>
      </div>

      {page ? (
        <AnnotationCanvas key={page.page_number} drawingId={drawingId} page={page} />
      ) : (
        <div className={styles.status}>Page {currentPage} not found.</div>
      )}
    </div>
  );
}
