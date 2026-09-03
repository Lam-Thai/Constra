"use client";

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import type { Annotation } from "@/lib/types";
import { patchAnnotationOcrText } from "@/lib/api";
import DrawingViewer from "./DrawingViewer";
import type { FocusRequest } from "./AnnotationCanvas";
import OcrControls from "./OcrControls";
import CapturedTextPanel from "./CapturedTextPanel";
import EstimatePanel from "./EstimatePanel";
import PriceCatalogPanel from "./PriceCatalogPanel";
import styles from "./TakeoffWorkspace.module.css";

type Tab = "captured" | "estimate" | "catalog";

interface TakeoffWorkspaceProps {
  drawingId: string;
}

export default function TakeoffWorkspace({ drawingId }: TakeoffWorkspaceProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [rawAnnotations, setRawAnnotations] = useState<Annotation[]>([]);
  // Hand-corrected ocr_text saved via the captured-text panel, keyed by
  // annotation id, together with the server `updated_at` the save produced.
  // AnnotationCanvas owns the authoritative annotations array and re-bubbles
  // it up (via onAnnotationsChange) on every one of its own state changes,
  // which would otherwise clobber a just-saved correction with the stale
  // text still sitting in its local state until the next full re-fetch —
  // this overlay keeps the panel showing the saved value in the meantime,
  // without reaching into AnnotationCanvas's internals to patch it there
  // too. Crucially, the override is only applied while it's newer than the
  // freshly re-fetched annotation's own `updated_at`: once a later write
  // (e.g. a `force=true` OCR re-run) lands with a newer timestamp, that
  // server value wins and the override stops applying — otherwise a
  // hand-corrected caption would shadow a legitimate later OCR update
  // forever, since this map is never explicitly cleared.
  const [ocrTextOverrides, setOcrTextOverrides] = useState<
    Record<string, { text: string; updatedAt: string }>
  >({});
  const pageAnnotations =
    Object.keys(ocrTextOverrides).length === 0
      ? rawAnnotations
      : rawAnnotations.map((a) => {
          const override = ocrTextOverrides[a.id];
          if (!override) return a;
          // ISO 8601 UTC timestamps compare correctly lexically. If the
          // re-fetched annotation is already at least as new as the saved
          // override, the server has since moved on (or already reflects
          // this exact save) — defer to it instead of the override.
          if (a.updated_at >= override.updatedAt) return a;
          return { ...a, ocr_text: override.text };
        });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<Tab>("captured");
  const [pageCount, setPageCount] = useState<number | null>(null);

  const handleOcrCompleted = useCallback(() => {
    // Either scope may have written ocr_* fields on the page currently
    // showing (an on-this-page run definitely did; a whole-drawing run may
    // have too) — bump the reload token so AnnotationCanvas re-fetches and
    // the captured-text panel picks up fresh status/confidence/text.
    setReloadToken((n) => n + 1);
  }, []);

  const handleFocusAnnotation = useCallback((id: string) => {
    setFocusRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  // Clears the stale-until-refetch annotations list whenever the page
  // actually changes, so the captured-text panel doesn't briefly show the
  // *previous* page's boxes while the new page's AnnotationCanvas instance
  // (remounted by DrawingViewer) is still loading.
  const changePage = useCallback(
    (n: number) => {
      if (n === currentPage) return;
      setRawAnnotations([]);
      setCurrentPage(n);
    },
    [currentPage]
  );

  const handleNavigateToSource = useCallback(
    (pageNumber: number, annotationId: string | null) => {
      const clamped = pageCount ? Math.min(Math.max(pageNumber, 1), pageCount) : pageNumber;
      changePage(clamped);
      if (annotationId) {
        setFocusRequest((prev) => ({ id: annotationId, nonce: (prev?.nonce ?? 0) + 1 }));
      }
    },
    [pageCount, changePage]
  );

  async function handleSaveOcrText(id: string, text: string) {
    const saved = await patchAnnotationOcrText(id, text);
    setOcrTextOverrides((prev) => ({
      ...prev,
      [id]: { text: saved.ocr_text ?? "", updatedAt: saved.updated_at },
    }));
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.main}>
        <OcrControls
          drawingId={drawingId}
          currentPage={currentPage}
          onCompleted={handleOcrCompleted}
        />
        <DrawingViewer
          drawingId={drawingId}
          currentPage={currentPage}
          onPageChange={changePage}
          onDrawingLoaded={(d) => setPageCount(d.page_count)}
          onAnnotationsChange={setRawAnnotations}
          onSelectionChange={setSelectedId}
          focusRequest={focusRequest}
          reloadToken={reloadToken}
        />
      </div>

      <div className={styles.sidebar}>
        <div className={styles.tabs}>
          {(
            [
              ["captured", "Captured Text"],
              ["estimate", "Estimate"],
              ["catalog", "Price Catalog"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <motion.button
              key={id}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ duration: 0.12 }}
              className={`${styles.tabButton} ${tab === id ? styles.tabButtonActive : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </motion.button>
          ))}
        </div>

        <div className={styles.tabContent}>
          {tab === "captured" && (
            <CapturedTextPanel
              annotations={pageAnnotations}
              selectedId={selectedId}
              onFocusAnnotation={handleFocusAnnotation}
              onSaveOcrText={handleSaveOcrText}
            />
          )}
          {tab === "estimate" && (
            <EstimatePanel drawingId={drawingId} onNavigateToSource={handleNavigateToSource} />
          )}
          {tab === "catalog" && <PriceCatalogPanel />}
        </div>
      </div>
    </div>
  );
}
