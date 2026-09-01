"use client";

import { useEffect, useState } from "react";
import type { DrawingDetail, DrawingSummary } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import DrawingViewer from "@/components/DrawingViewer";
import ImportDrawingButton from "@/components/ImportDrawingButton";
import styles from "./page.module.css";

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
    return <div className={styles.status}>Loading…</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <select
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
        </select>
        <ImportDrawingButton
          onImported={handleImported}
          existingNames={drawings.map((d) => d.name)}
        />
      </div>

      {selectedId ? (
        <DrawingViewer key={selectedId} drawingId={selectedId} />
      ) : (
        <div className={styles.status}>
          <p>No drawings found. Import a PDF or image to get started.</p>
        </div>
      )}
    </div>
  );
}
