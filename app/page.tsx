"use client";

import { useEffect, useState } from "react";
import type { DrawingSummary } from "@/lib/types";
import DrawingViewer from "@/components/DrawingViewer";
import styles from "./page.module.css";

export default function Home() {
  const [drawings, setDrawings] = useState<DrawingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/drawings")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load drawings (${res.status})`);
        return res.json() as Promise<DrawingSummary[]>;
      })
      .then(setDrawings)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load drawings")
      );
  }, []);

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

  const first = drawings[0];
  if (!first) {
    return (
      <div className={styles.status}>
        <p>No drawings found. Run the import script to seed one.</p>
      </div>
    );
  }

  return <DrawingViewer drawingId={first.id} />;
}
