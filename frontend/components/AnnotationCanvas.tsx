"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationType, PageInfo } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import {
  type Corner,
  type Point,
  type Rect,
  normalizedDistancePx,
  rectFromCorners,
  rectsEqual,
  resizeRectFromCorner,
  translateRect,
} from "@/lib/rect";
import styles from "./AnnotationCanvas.module.css";

const COLORS: Record<AnnotationType, { stroke: string; fill: string }> = {
  ignore: { stroke: "#e5484d", fill: "rgba(229, 72, 77, 0.18)" },
  capture: { stroke: "#30a46c", fill: "rgba(48, 164, 108, 0.18)" },
};

const SELECTED_STROKE = "#1a73e8";
const MIN_DRAG_PX = 4;
const HANDLE_SIZE = 9;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

type Mode = AnnotationType | "select";

type DrawState = { type: AnnotationType; anchor: Point; current: Point };
type MoveState = { id: string; startPointer: Point; original: Rect; current: Rect };
type ResizeState = { id: string; corner: Corner; original: Rect; current: Rect };

function toNormalizedPoint(e: { clientX: number; clientY: number }, svgEl: SVGSVGElement): Point {
  const rect = svgEl.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: (e.clientX - rect.left) / width,
    y: (e.clientY - rect.top) / height,
  };
}

interface AnnotationCanvasProps {
  drawingId: string;
  page: PageInfo;
}

export default function AnnotationCanvas({ drawingId, page }: AnnotationCanvasProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Tracks in-flight create POSTs, keyed by the temp id of the optimistic
  // annotation they belong to. A delete/move/resize requested on an
  // annotation that's still "saving" looks itself up here and awaits the
  // real id before touching the server, instead of firing a request against
  // `temp-...` (which isn't a valid UUID and 404s at Django's URL-routing
  // layer before it ever reaches a real row) — see createAnnotation,
  // deleteAnnotation, and updateAnnotation below.
  const pendingCreatesRef = useRef<Map<string, Promise<Annotation>>>(new Map());

  // Load annotations for this page fresh every time the page changes (or on
  // first mount) — this is the client-side half of persistence: the backend
  // already stores rows correctly, but the UI has to re-fetch them or a
  // reload would just show a blank overlay. AnnotationCanvas is remounted
  // (via `key={page.page_number}` in DrawingViewer) on every page change, so
  // `loading`/`selectedId`/drag state all start fresh without needing to be
  // reset here.
  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl(`/api/drawings/${drawingId}/pages/${page.page_number}/annotations/`))
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load annotations (${res.status})`);
        return res.json() as Promise<Annotation[]>;
      })
      .then((data) => {
        if (!cancelled) setAnnotations(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAnnotations([]);
          setError(err instanceof Error ? err.message : "Failed to load annotations");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [drawingId, page.page_number]);

  const createAnnotation = useCallback(
    (type: AnnotationType, rect: Rect) => {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const optimistic: Annotation = {
        id: tempId,
        drawing_id: drawingId,
        page_number: page.page_number,
        type,
        ...rect,
        ocr_text: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "saving",
      };
      setAnnotations((prev) => [...prev, optimistic]);

      // Fire the POST and stash the raw promise (not just its .then chain)
      // keyed by tempId *before* awaiting anything, so a delete/move/resize
      // that lands moments later — before this resolves — can find it via
      // pendingCreatesRef and wait for the real id instead of racing ahead
      // with the temp one.
      const createPromise = (async () => {
        const res = await fetch(
          apiUrl(`/api/drawings/${drawingId}/pages/${page.page_number}/annotations/`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, ...rect }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to create annotation (${res.status})`);
        }
        return (await res.json()) as Annotation;
      })();

      pendingCreatesRef.current.set(tempId, createPromise);

      createPromise
        .then((saved) => {
          // Adopt the server's real id/timestamps, but keep whatever rect is
          // currently in local state: a move/resize may have started against
          // the temp id while this create was still in flight, and its own
          // optimistic update must not be clobbered by the (now-stale) rect
          // this create request was originally sent with. If a delete beat
          // us here, the temp id is already gone from `prev` and this is a
          // harmless no-op — nothing gets resurrected.
          setAnnotations((prev) =>
            prev.map((a) =>
              a.id === tempId
                ? { ...saved, x: a.x, y: a.y, width: a.width, height: a.height, status: undefined }
                : a
            )
          );
          setSelectedId((cur) => (cur === tempId ? saved.id : cur));
        })
        .catch((err: unknown) => {
          setAnnotations((prev) => prev.filter((a) => a.id !== tempId));
          setSelectedId((cur) => (cur === tempId ? null : cur));
          setError(err instanceof Error ? err.message : "Failed to create annotation");
        })
        .finally(() => {
          if (pendingCreatesRef.current.get(tempId) === createPromise) {
            pendingCreatesRef.current.delete(tempId);
          }
        });
    },
    [drawingId, page.page_number]
  );

  const updateAnnotation = useCallback(
    async (id: string, next: Rect, original: Annotation) => {
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));

      // If this annotation's create POST hasn't resolved yet, wait for the
      // real id before issuing the PATCH — `id` here may still be a temp id.
      let realId = id;
      let restoreTo = original;
      const pending = pendingCreatesRef.current.get(id);
      if (pending) {
        try {
          const saved = await pending;
          realId = saved.id;
          // `saved` reflects the annotation exactly as it was created, i.e.
          // before this move/resize — the correct rollback target, with the
          // real id attached instead of the temp one `original` still has.
          restoreTo = saved;
        } catch {
          // The create itself failed; its own catch handler already dropped
          // the optimistic item from state. Nothing exists server-side to
          // patch, so there's nothing more to do.
          return;
        }
      }

      try {
        const res = await fetch(apiUrl(`/api/annotations/${realId}/`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed to update annotation (${res.status})`);
        }
        const saved = (await res.json()) as Annotation;
        setAnnotations((prev) => prev.map((a) => (a.id === realId || a.id === id ? saved : a)));
      } catch (err) {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === realId || a.id === id ? restoreTo : a))
        );
        setError(err instanceof Error ? err.message : "Failed to update annotation");
      }
    },
    []
  );

  const deleteAnnotation = useCallback(async (id: string) => {
    let backup: Annotation[] = [];
    setAnnotations((prev) => {
      backup = prev;
      return prev.filter((a) => a.id !== id);
    });
    setSelectedId(null);

    // Same pending-create handling as updateAnnotation: if the create POST
    // for this annotation hasn't resolved yet, wait for it rather than
    // firing DELETE against a temp id (which 404s at the URL-routing layer,
    // not at "annotation not found" — the old code treated that 404 as a
    // failed delete and resurrected the optimistic item, even though the
    // create then went on to persist it for real).
    let realId = id;
    let restoreList = backup;
    const pending = pendingCreatesRef.current.get(id);
    if (pending) {
      try {
        const saved = await pending;
        realId = saved.id;
        restoreList = backup.map((a) => (a.id === id ? saved : a));
      } catch {
        // Create failed outright — nothing was ever persisted, so the
        // delete this function already applied optimistically is correct
        // as-is. Nothing to send to the server.
        return;
      }
    }

    try {
      const res = await fetch(apiUrl(`/api/annotations/${realId}/`), { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to delete annotation (${res.status})`);
      }
    } catch (err) {
      setAnnotations(restoreList);
      setError(err instanceof Error ? err.message : "Failed to delete annotation");
    }
  }, []);

  // Delete/Backspace removes the selected rectangle, unless the user is
  // typing in a text input elsewhere on the page (e.g. the jump-to-page box).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isTyping) return;

      if ((e.key === "Delete" || e.key === "Backspace") && mode === "select" && selectedId) {
        e.preventDefault();
        deleteAnnotation(selectedId);
      }
      if (e.key === "Escape") {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, selectedId, deleteAnnotation]);

  function handleSvgPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    if (mode !== "select") {
      const point = toNormalizedPoint(e, svgEl);
      svgEl.setPointerCapture(e.pointerId);
      setDrawState({ type: mode, anchor: point, current: point });
      return;
    }

    // Click on empty canvas background (not a rect/handle, those stop
    // propagation themselves) deselects the current selection.
    if (e.target === svgEl) {
      setSelectedId(null);
    }
  }

  function handleSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const point = toNormalizedPoint(e, svgEl);

    if (drawState) {
      setDrawState({ ...drawState, current: point });
    } else if (moveState) {
      const dx = point.x - moveState.startPointer.x;
      const dy = point.y - moveState.startPointer.y;
      setMoveState({ ...moveState, current: translateRect(moveState.original, dx, dy) });
    } else if (resizeState) {
      setResizeState({
        ...resizeState,
        current: resizeRectFromCorner(resizeState.original, resizeState.corner, point),
      });
    }
  }

  function handleSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const boxRect = svgEl.getBoundingClientRect();

    if (drawState) {
      const dist = normalizedDistancePx(
        drawState.anchor,
        drawState.current,
        boxRect.width,
        boxRect.height
      );
      if (dist >= MIN_DRAG_PX) {
        const rect = rectFromCorners(drawState.anchor, drawState.current);
        if (rect.width > 0 && rect.height > 0) {
          createAnnotation(drawState.type, rect);
        }
      }
      setDrawState(null);
    } else if (moveState) {
      const original = annotations.find((a) => a.id === moveState.id);
      if (original && !rectsEqual(moveState.current, original)) {
        updateAnnotation(moveState.id, moveState.current, original);
      }
      setMoveState(null);
    } else if (resizeState) {
      const original = annotations.find((a) => a.id === resizeState.id);
      if (
        original &&
        !rectsEqual(resizeState.current, original) &&
        resizeState.current.width > 0 &&
        resizeState.current.height > 0
      ) {
        updateAnnotation(resizeState.id, resizeState.current, original);
      }
      setResizeState(null);
    }

    if (svgEl.hasPointerCapture(e.pointerId)) {
      svgEl.releasePointerCapture(e.pointerId);
    }
  }

  function handleRectPointerDown(e: React.PointerEvent<SVGRectElement>, a: Annotation) {
    if (mode !== "select") return;
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const point = toNormalizedPoint(e, svgEl);
    svgEl.setPointerCapture(e.pointerId);
    setSelectedId(a.id);
    setMoveState({
      id: a.id,
      startPointer: point,
      original: { x: a.x, y: a.y, width: a.width, height: a.height },
      current: { x: a.x, y: a.y, width: a.width, height: a.height },
    });
  }

  function handleHandlePointerDown(e: React.PointerEvent<SVGElement>, a: Annotation, corner: Corner) {
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;
    svgEl.setPointerCapture(e.pointerId);
    setSelectedId(a.id);
    setResizeState({
      id: a.id,
      corner,
      original: { x: a.x, y: a.y, width: a.width, height: a.height },
      current: { x: a.x, y: a.y, width: a.width, height: a.height },
    });
  }

  function pct(n: number): string {
    return `${n * 100}%`;
  }

  const drawPreview =
    drawState && (() => {
      const rect = rectFromCorners(drawState.anchor, drawState.current);
      const colors = COLORS[drawState.type];
      return (
        <rect
          x={pct(rect.x)}
          y={pct(rect.y)}
          width={pct(rect.width)}
          height={pct(rect.height)}
          fill={colors.fill}
          stroke={colors.stroke}
          strokeWidth={2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      );
    })();

  const selectedAnnotation = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "ignore" ? styles.modeButtonActive : ""}`}
          onClick={() => setMode("ignore")}
        >
          <span className={`${styles.swatch} ${styles.swatchIgnore}`} />
          Ignore (red)
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "capture" ? styles.modeButtonActive : ""}`}
          onClick={() => setMode("capture")}
        >
          <span className={`${styles.swatch} ${styles.swatchCapture}`} />
          Capture (green)
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${mode === "select" ? styles.modeButtonActive : ""}`}
          onClick={() => setMode("select")}
        >
          Select
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.deleteButton}
          disabled={!selectedAnnotation}
          onClick={() => selectedAnnotation && deleteAnnotation(selectedAnnotation.id)}
        >
          Delete selected
        </button>
      </div>

      {mode !== "select" && (
        <span className={styles.hint}>Drag on the drawing to draw a rectangle.</span>
      )}
      {mode === "select" && (
        <span className={styles.hint}>
          Click a rectangle to select it, drag its body to move or a corner to resize. Delete/Backspace removes it.
        </span>
      )}

      {error && (
        <div className={styles.errorBanner}>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.imageStage} style={{ maxWidth: page.width }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.image_url}
          alt={`Page ${page.page_number}`}
          className={styles.pageImage}
          draggable={false}
        />
        <svg
          ref={svgRef}
          className={styles.overlay}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          style={{ cursor: mode === "select" ? "default" : "crosshair" }}
        >
          {annotations.map((a) => {
            const isBeingMoved = moveState?.id === a.id;
            const isBeingResized = resizeState?.id === a.id;
            const live = isBeingMoved
              ? moveState!.current
              : isBeingResized
              ? resizeState!.current
              : { x: a.x, y: a.y, width: a.width, height: a.height };
            const colors = COLORS[a.type];
            const isSelected = mode === "select" && selectedId === a.id;
            const isSaving = a.status === "saving";

            return (
              <g key={a.id} opacity={isSaving ? 0.6 : 1}>
                <rect
                  x={pct(live.x)}
                  y={pct(live.y)}
                  width={pct(live.width)}
                  height={pct(live.height)}
                  fill={colors.fill}
                  stroke={isSelected ? SELECTED_STROKE : colors.stroke}
                  strokeWidth={isSelected ? 3 : 2}
                  strokeDasharray={isSaving ? "4 3" : undefined}
                  style={{ pointerEvents: mode === "select" ? "auto" : "none", cursor: mode === "select" ? "move" : undefined }}
                  onPointerDown={(e) => handleRectPointerDown(e, a)}
                />
                {isSelected &&
                  CORNERS.map((corner) => {
                    const cx =
                      corner === "nw" || corner === "sw" ? live.x : live.x + live.width;
                    const cy =
                      corner === "nw" || corner === "ne" ? live.y : live.y + live.height;
                    const cursor =
                      corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize";
                    return (
                      <rect
                        key={corner}
                        x={`calc(${pct(cx)} - ${HANDLE_SIZE / 2}px)`}
                        y={`calc(${pct(cy)} - ${HANDLE_SIZE / 2}px)`}
                        width={HANDLE_SIZE}
                        height={HANDLE_SIZE}
                        fill="#fff"
                        stroke={SELECTED_STROKE}
                        strokeWidth={2}
                        style={{ cursor }}
                        onPointerDown={(e) => handleHandlePointerDown(e, a, corner)}
                      />
                    );
                  })}
              </g>
            );
          })}
          {drawPreview}
        </svg>
      </div>

      {loading && <span className={styles.loadingNote}>Loading annotations…</span>}
    </div>
  );
}
