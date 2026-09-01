"use client";

import { useRef, useState } from "react";
import type { DrawingDetail } from "@/lib/types";
import { uploadDrawing } from "@/lib/api";
import styles from "./ImportDrawingButton.module.css";

interface ImportDrawingButtonProps {
  onImported: (drawing: DrawingDetail) => void;
  // Names of drawings that already exist, used to warn before an upload
  // silently replaces one (the backend upserts by name).
  existingNames: string[];
}

// Strips the extension and swaps separators for spaces, e.g.
// "site-plan_v2.pdf" -> "site-plan v2", as a starting point for the
// editable name field — the user can still change it before submitting.
function deriveName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, "");
}

export default function ImportDrawingButton({ onImported, existingNames }: ImportDrawingButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the user hits Upload and we've detected the (possibly edited)
  // name collides with an existing drawing — shows a replace-confirmation
  // step instead of submitting immediately. Null means no collision found yet.
  const [confirmingReplaceName, setConfirmingReplaceName] = useState<string | null>(null);

  function openFilePicker() {
    setError(null);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    if (file) {
      setPickedFile(file);
      setName(deriveName(file.name));
      setConfirmingReplaceName(null);
    }
  }

  function resetFileInput() {
    setPickedFile(null);
    setName("");
    setConfirmingReplaceName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitUpload() {
    if (!pickedFile) return;
    setUploading(true);
    setError(null);
    try {
      const trimmed = name.trim();
      const drawing = await uploadDrawing(pickedFile, trimmed || undefined);
      onImported(drawing);
      resetFileInput();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import drawing");
      setConfirmingReplaceName(null);
    } finally {
      setUploading(false);
    }
  }

  function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickedFile) return;
    const trimmed = name.trim();
    // Mirror the backend's blank-name fallback (derived from the filename)
    // so the collision check matches what will actually be submitted.
    const effectiveName = trimmed || deriveName(pickedFile.name).trim();
    if (existingNames.includes(effectiveName)) {
      setConfirmingReplaceName(effectiveName);
      return;
    }
    void submitUpload();
  }

  function handleConfirmReplace() {
    void submitUpload();
  }

  function handleCancelReplace() {
    // Stay on the name-edit step so the user can rename instead of
    // resetting the whole picked-file state.
    setConfirmingReplaceName(null);
  }

  return (
    <div className={styles.wrapper}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg"
        onChange={handleFileChange}
        className={styles.hiddenInput}
        aria-label="Choose drawing file"
      />

      {!pickedFile ? (
        <button type="button" onClick={openFilePicker} disabled={uploading}>
          Import
        </button>
      ) : confirmingReplaceName ? (
        <div className={styles.confirmForm}>
          <span className={styles.warning}>
            A drawing named &ldquo;{confirmingReplaceName}&rdquo; already exists and will be
            replaced (its annotations will be lost). Replace it?
          </span>
          <button type="button" onClick={handleConfirmReplace} disabled={uploading}>
            {uploading ? "Uploading…" : "Replace"}
          </button>
          <button type="button" onClick={handleCancelReplace} disabled={uploading}>
            Cancel
          </button>
        </div>
      ) : (
        <form className={styles.confirmForm} onSubmit={handleUploadSubmit}>
          <input
            className={styles.nameInput}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Drawing name"
            aria-label="Drawing name"
            disabled={uploading}
          />
          <button type="submit" disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <button type="button" onClick={resetFileInput} disabled={uploading}>
            Cancel
          </button>
        </form>
      )}

      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
