"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { UnitPrice, UnitPriceImportResult } from "@/lib/types";
import { importUnitPriceCsv, listUnitPrices, patchUnitPrice, unitPriceTemplateCsvUrl } from "@/lib/api";
import Spinner from "./Spinner";
import styles from "./PriceCatalogPanel.module.css";

function RateCell({ price, onSaved }: { price: UnitPrice; onSaved: (updated: UnitPrice) => void }) {
  const [value, setValue] = useState(price.unit_cost);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Render-time derivation (see CapturedTextPanel's identical pattern):
  // adopt the server value unless the user has an in-progress edit.
  const [lastServerValue, setLastServerValue] = useState(price.unit_cost);
  if (lastServerValue !== price.unit_cost) {
    setLastServerValue(price.unit_cost);
    if (!dirty) setValue(price.unit_cost);
  }

  async function handleBlur() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await patchUnitPrice(price.id, { unit_cost: value });
      onSaved(updated);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save rate");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.rateCell}>
      <input
        className={styles.rateInput}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        onBlur={handleBlur}
        aria-label={`Unit cost for ${price.code}`}
      />
      {saving && <Spinner size={11} />}
      {error && <span className={styles.rateError}>{error}</span>}
    </div>
  );
}

export default function PriceCatalogPanel() {
  const [prices, setPrices] = useState<UnitPrice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<UnitPriceImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listUnitPrices()
      .then((data) => {
        if (!cancelled) setPrices(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load price catalog");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaved(updated: UnitPrice) {
    setPrices((prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importUnitPriceCsv(file);
      setImportResult(result);
      // Re-fetch the full catalog rather than trying to merge the import
      // result in place — the import upserts by `code`, which this
      // response doesn't map back to specific rows.
      const refreshed = await listUnitPrices();
      setPrices(refreshed);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import CSV");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (loadError) {
    return <p className={styles.loadError}>{loadError}</p>;
  }

  if (!prices) {
    return (
      <span className={styles.loadingNote}>
        <Spinner size={13} />
        Loading price catalog…
      </span>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.importRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className={styles.hiddenInput}
          id="price-csv-input"
          aria-label="Upload price catalog CSV"
        />
        <motion.label
          htmlFor="price-csv-input"
          className={styles.uploadButton}
          whileHover={importing ? undefined : { scale: 1.02 }}
          whileTap={importing ? undefined : { scale: 0.98 }}
        >
          {importing ? (
            <span className={styles.buttonContent}>
              <Spinner size={12} />
              Importing…
            </span>
          ) : (
            "Upload price CSV"
          )}
        </motion.label>
        <a className={styles.templateLink} href={unitPriceTemplateCsvUrl()} download>
          Download template CSV
        </a>
      </div>

      <AnimatePresence>
        {importError && (
          <motion.div
            key="import-error"
            className={styles.errorBanner}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <span>{importError}</span>
            <button type="button" onClick={() => setImportError(null)}>
              Dismiss
            </button>
          </motion.div>
        )}
        {importResult && (
          <motion.div
            key="import-result"
            className={styles.resultBanner}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
          >
            <div className={styles.resultHeader}>
              <span>
                {importResult.created} created, {importResult.updated} updated
                {importResult.errors.length > 0 ? `, ${importResult.errors.length} row error(s)` : ""}.
              </span>
              <button type="button" onClick={() => setImportResult(null)}>
                Dismiss
              </button>
            </div>
            {importResult.errors.length > 0 && (
              <ul className={styles.errorList}>
                {importResult.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {prices.length === 0 && (
        <p className={styles.empty}>
          No prices in the catalog yet. Upload a CSV above (see the template) to add rates.
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Rate</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.id}>
                <td className={styles.codeCell}>{p.code}</td>
                <td>{p.description}</td>
                <td>{p.category}</td>
                <td>{p.unit}</td>
                <td>
                  <RateCell price={p} onSaved={handleSaved} />
                </td>
                <td>
                  <span className={styles.sourceBadge}>{p.source}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
