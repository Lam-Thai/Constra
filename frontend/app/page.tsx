"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { DrawingDetail, DrawingSummary } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import DrawingViewer from "@/components/DrawingViewer";
import ImportDrawingButton from "@/components/ImportDrawingButton";
import ThemeToggle from "@/components/ThemeToggle";
import Spinner from "@/components/Spinner";
import styles from "./page.module.css";

const toolbarContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.02 },
  },
};

const toolbarItem: Variants = {
  hidden: { opacity: 0, y: -4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: "easeOut" } },
};

export default function Home() {
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/drawings/"))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load drawings (${res.status})`);
        return res.json() as Promise<DrawingSummary[]>;
      })
      .then((data) => {
        setDrawings(data);
        // Default to the first drawing on initial load only — this is a
        // reasonable default now that there's a visible selector, unlike
        // the old hardcoded "always show drawings[0]" behavior.
        setSelectedId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load drawings")
      );
  }, []);

  // Called with the full response body from a successful upload (already
  // has page data — no need to re-fetch). Upserts it into the dropdown by
  // id (normal case) or name (the backend replaces an existing drawing's
  // pages in place when the name matches, which may or may not keep the
  // same id) and switches the viewer to it right away.
  function handleImported(drawing: DrawingDetail) {
    const summary: DrawingSummary = {
      id: drawing.id,
      name: drawing.name,
      page_count: drawing.page_count,
    };
    setDrawings((prev) => {
      if (!prev) return [summary];
      const idx = prev.findIndex((d) => d.id === drawing.id || d.name === drawing.name);
      if (idx === -1) return [...prev, summary];
      const next = [...prev];
      next[idx] = summary;
      return next;
    });
    setSelectedId(drawing.id);
  }

  if (error) {
    return (
      <div className={styles.status}>
        <p>{error}</p>
      </div>
    );
  }

  if (!drawings) {
    return (
      <div className={styles.status}>
        <div className={styles.statusInner}>
          <Spinner size={20} />
          <span>Loading drawings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <motion.div
        className={styles.toolbar}
        variants={toolbarContainer}
        initial="hidden"
        animate="show"
      >
        <motion.select
          variants={toolbarItem}
          className={styles.drawingSelect}
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value || null)}
          disabled={drawings.length === 0}
          aria-label="Select drawing"
        >
          {drawings.length === 0 ? (
            <option value="">No drawings</option>
          ) : (
            drawings.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))
          )}
        </motion.select>
        <motion.div variants={toolbarItem}>
          <ImportDrawingButton
            onImported={handleImported}
            existingNames={drawings.map((d) => d.name)}
          />
        </motion.div>
        <span className={styles.spacer} />
        <motion.div variants={toolbarItem}>
          <ThemeToggle />
        </motion.div>
      </motion.div>

      <AnimatePresence mode="wait">
        {selectedId ? (
          <motion.div
            key={selectedId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={styles.viewerSlot}
          >
            <DrawingViewer drawingId={selectedId} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={styles.status}
          >
            <div className={styles.emptyState}>
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className={styles.emptyIcon}
              >
                <path
                  d="M6 2.5h9l4.5 4.5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M15 2.5V7a1 1 0 0 0 1 1h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <p>No drawings found.</p>
              <p className={styles.emptyHint}>Import a PDF or image to get started.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
