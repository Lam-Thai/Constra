"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DrawingDetail } from "@/lib/types";
import { uploadDrawing } from "@/lib/api";
import Spinner from "./Spinner";
import styles from "./ImportDrawingButton.module.css";

const TAP = { scale: 0.96 };
const HOVER = { scale: 1.03 };
const BUTTON_TRANSITION = { duration: 0.12 };

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

      <AnimatePresence mode="wait" initial={false}>
        {!pickedFile ? (
          <motion.div
            key="import"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <motion.button
              type="button"
              whileHover={uploading ? undefined : HOVER}
              whileTap={uploading ? undefined : TAP}
              transition={BUTTON_TRANSITION}
              onClick={openFilePicker}
              disabled={uploading}
            >
              Import
            </motion.button>
          </motion.div>
        ) : confirmingReplaceName ? (
          <motion.div
            key="confirm"
            className={styles.confirmForm}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <span className={styles.warning}>
              A drawing named &ldquo;{confirmingReplaceName}&rdquo; already exists and will be
              replaced (its annotations will be lost). Replace it?
            </span>
            <motion.button
              type="button"
              whileHover={uploading ? undefined : HOVER}
              whileTap={uploading ? undefined : TAP}
              transition={BUTTON_TRANSITION}
              className={styles.dangerButton}
              onClick={handleConfirmReplace}
              disabled={uploading}
            >
              {uploading ? (
                <span className={styles.buttonWithSpinner}>
                  <Spinner size={13} />
                  Uploading…
                </span>
              ) : (
                "Replace"
              )}
            </motion.button>
            <motion.button
              type="button"
              whileHover={uploading ? undefined : HOVER}
              whileTap={uploading ? undefined : TAP}
              transition={BUTTON_TRANSITION}
              onClick={handleCancelReplace}
              disabled={uploading}
            >
              Cancel
            </motion.button>
          </motion.div>
        ) : (
          <motion.form
            key="name"
            className={styles.confirmForm}
            onSubmit={handleUploadSubmit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <input
              className={styles.nameInput}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Drawing name"
              aria-label="Drawing name"
              disabled={uploading}
            />
            <motion.button
              type="submit"
              whileHover={uploading ? undefined : HOVER}
              whileTap={uploading ? undefined : TAP}
              transition={BUTTON_TRANSITION}
              disabled={uploading}
            >
              {uploading ? (
                <span className={styles.buttonWithSpinner}>
                  <Spinner size={13} />
                  Uploading…
                </span>
              ) : (
                "Upload"
              )}
            </motion.button>
            <motion.button
              type="button"
              whileHover={uploading ? undefined : HOVER}
              whileTap={uploading ? undefined : TAP}
              transition={BUTTON_TRANSITION}
              onClick={resetFileInput}
              disabled={uploading}
            >
              Cancel
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.span
            key="error"
            className={styles.error}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
