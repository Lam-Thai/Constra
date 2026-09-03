"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { EstimateLineItem, EstimateRun } from "@/lib/types";
import {
  ApiError,
  estimateExportCsvUrl,
  estimateReportUrl,
  generateEstimate,
  getEstimate,
  listEstimates,
} from "@/lib/api";
import Spinner from "./Spinner";
import styles from "./EstimatePanel.module.css";

interface EstimatePanelProps {
  drawingId: string;
  onNavigateToSource: (pageNumber: number, annotationId: string | null) => void;
}

// Maps the three documented failure statuses to an actionable, specific
// message (API-CONTRACT.md) — never a raw status code or stack trace.
function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) {
      return "AI estimating isn't configured — add GEMINI_API_KEY to backend/.env.";
    }
    if (err.status === 400) {
      return "Run OCR first — no captured text yet.";
    }
    if (err.status === 502) {
      return "Estimate generation failed upstream — this is usually transient, try again.";
    }
    return err.message || `Estimate request failed (${err.status}).`;
  }
  return err instanceof Error ? err.message : "Failed to generate estimate.";
}

function groupLineItems(items: EstimateLineItem[]) {
  const byCategory = new Map<string, Map<number, EstimateLineItem[]>>();
  for (const item of items) {
    const category = item.category || "Uncategorized";
    if (!byCategory.has(category)) byCategory.set(category, new Map());
    const byPage = byCategory.get(category)!;
    if (!byPage.has(item.page_number)) byPage.set(item.page_number, []);
    byPage.get(item.page_number)!.push(item);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, byPage]) => ({
      category,
      pages: [...byPage.entries()].sort(([a], [b]) => a - b),
    }));
}

// Client-side sum, purely a display convenience — explicitly labeled as
// approximate (see EstimatePanel.module.css .approx) since the server's
// `subtotal`/`total` fields (Decimal, computed with ROUND_HALF_UP) are the
// source of truth, never this.
function approxSum(items: EstimateLineItem[]): string {
  const sum = items.reduce((acc, item) => acc + (Number.parseFloat(item.line_total) || 0), 0);
  return sum.toFixed(2);
}

export default function EstimatePanel({ drawingId, onNavigateToSource }: EstimatePanelProps) {
  const [wastePct, setWastePct] = useState("10");
  const [markupPct, setMarkupPct] = useState("15");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<EstimateRun | null>(null);
  const [history, setHistory] = useState<EstimateRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // No explicit setHistoryLoading(true) here: `historyLoading` already
    // starts `true` from useState above, and this component is remounted
    // fresh (new `key`) whenever the selected drawing changes (see
    // TakeoffWorkspace's caller in app/page.tsx), so there's no case where
    // this effect re-runs on an already-mounted instance with stale data.
    listEstimates(drawingId)
      .then(async (list) => {
        if (cancelled) return;
        setHistory(list);
        if (list.length > 0) {
          const detail = await getEstimate(list[0].id);
          if (!cancelled) setRun(detail);
        }
      })
      .catch(() => {
        // History is a convenience, not required for the primary flow —
        // fail silently rather than blocking the Generate form with an
        // error the user didn't cause.
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawingId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const waste = Number.parseFloat(wastePct);
      const markup = Number.parseFloat(markupPct);
      const result = await generateEstimate(
        drawingId,
        Number.isFinite(waste) ? waste : 0,
        Number.isFinite(markup) ? markup : 0
      );
      setRun(result);
      setHistory((prev) => [result, ...prev]);
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSelectHistory(id: string) {
    if (!id) return;
    const cached = run?.id === id ? run : null;
    if (cached) return;
    try {
      const detail = await getEstimate(id);
      setRun(detail);
    } catch (err) {
      setError(messageForError(err));
    }
  }

  const groups = useMemo(() => groupLineItems(run?.line_items ?? []), [run]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.form}>
        <label className={styles.field}>
          Waste %
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={wastePct}
            onChange={(e) => setWastePct(e.target.value)}
            disabled={generating}
          />
        </label>
        <label className={styles.field}>
          Markup %
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={markupPct}
            onChange={(e) => setMarkupPct(e.target.value)}
            disabled={generating}
          />
        </label>
        <motion.button
          type="button"
          whileHover={generating ? undefined : { scale: 1.02 }}
          whileTap={generating ? undefined : { scale: 0.98 }}
          transition={{ duration: 0.12 }}
          className={styles.generateButton}
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? (
            <span className={styles.buttonContent}>
              <Spinner size={13} />
              Generating…
            </span>
          ) : (
            "Generate Estimate"
          )}
        </motion.button>
      </div>

      {history.length > 0 && (
        <label className={styles.field}>
          History
          <select
            value={run?.id ?? ""}
            onChange={(e) => handleSelectHistory(e.target.value)}
            disabled={historyLoading}
          >
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {new Date(h.created_at).toLocaleString()} — {h.status}
              </option>
            ))}
          </select>
        </label>
      )}

      <AnimatePresence>
        {error && (
          <motion.div
            key="estimate-error"
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
      </AnimatePresence>

      {run && (
        <div className={styles.results}>
          <div className={styles.disclaimer}>AI-generated draft — verify before bidding.</div>

          {run.status === "failed" && (
            <div className={styles.errorBanner}>
              Estimate run failed: {run.error_message || "unknown error"}.
            </div>
          )}

          {run.summary && <p className={styles.summary}>{run.summary}</p>}

          <div className={styles.actions}>
            <a
              className={styles.linkButton}
              href={estimateExportCsvUrl(run.id)}
              download
            >
              Download CSV
            </a>
            <a
              className={styles.linkButton}
              href={estimateReportUrl(run.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open printable report
            </a>
          </div>

          <div className={styles.totals}>
            <div>
              <span className={styles.totalLabel}>Subtotal</span>
              <span>{run.currency} {run.subtotal}</span>
            </div>
            <div>
              <span className={styles.totalLabel}>Waste ({run.waste_pct}%)</span>
              <span>{run.currency} {run.waste_amount}</span>
            </div>
            <div>
              <span className={styles.totalLabel}>Markup ({run.markup_pct}%)</span>
              <span>{run.currency} {run.markup_amount}</span>
            </div>
            <div className={styles.grandTotal}>
              <span className={styles.totalLabel}>Total</span>
              <span>{run.currency} {run.total}</span>
            </div>
          </div>

          <div className={styles.groups}>
            {groups.length === 0 && (
              <p className={styles.empty}>No line items in this run.</p>
            )}
            {groups.map((group) => {
              const allItems = group.pages.flatMap(([, items]) => items);
              return (
                <div key={group.category} className={styles.categoryGroup}>
                  <div className={styles.categoryHeader}>
                    <span>{group.category}</span>
                    <span className={styles.approx} title="Client-side sum — the server total above is authoritative">
                      ≈ {run.currency} {approxSum(allItems)}
                    </span>
                  </div>
                  {group.pages.map(([pageNumber, items]) => (
                    <div key={pageNumber} className={styles.pageGroup}>
                      <div className={styles.pageLabel}>Page {pageNumber}</div>
                      <div className={styles.tableScroll}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>Qty</th>
                              <th>Unit cost</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => {
                              const flagged = item.needs_review || item.match_method === "unmatched";
                              // Three distinct states, three distinct messages. A
                              // "weak" row DID find a plausible catalog row but is
                              // deliberately not priced, so saying "unmatched"
                              // there would be wrong, and saying nothing would
                              // hide why the line reads $0.00.
                              const flagLabel =
                                item.match_method === "unmatched"
                                  ? "No price match"
                                  : item.match_method === "weak"
                                    ? "Suggested — not priced"
                                    : "Needs review";
                              return (
                                <tr
                                  key={item.id}
                                  className={`${styles.itemRow} ${flagged ? styles.itemRowFlagged : ""}`}
                                  onClick={() => onNavigateToSource(item.page_number, item.annotation_id)}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      onNavigateToSource(item.page_number, item.annotation_id);
                                    }
                                  }}
                                  title={
                                    item.annotation_id
                                      ? "Click to jump to the source rectangle"
                                      : "No source annotation linked — provenance unavailable"
                                  }
                                >
                                  <td>
                                    {item.description}
                                    <span className={styles.matchNote}>
                                      {" · "}
                                      {item.match_method}
                                      {item.unit_price_code ? ` · ${item.unit_price_code}` : ""}
                                      {" · match "}
                                      {item.match_confidence}
                                    </span>
                                    {flagged && <span className={styles.flagBadge}>{flagLabel}</span>}
                                  </td>
                                  <td className={styles.nowrap}>
                                    {item.quantity} {item.unit}
                                  </td>
                                  <td className={styles.nowrap}>{item.unit_cost}</td>
                                  <td className={styles.nowrap}>{item.line_total}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
