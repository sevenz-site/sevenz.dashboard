"use client";

import { createContext, useContext } from "react";
import type { ExtractedMovement } from "@/lib/types";
import type { ImportUsage } from "@/lib/import-usage";

export type ImportJobStatus = "queued" | "processing" | "done" | "error";

export type ImportJob = {
  id: string;
  fileName: string;
  previewUrl: string;
  status: ImportJobStatus;
  movements: ExtractedMovement[];
  error: string | null;
};

export type ImportContextValue = {
  jobs: ImportJob[];
  isProcessing: boolean;
  usage: ImportUsage;
  startImport: (files: File[]) => void;
  removeJob: (id: string) => void;
  clearJobs: () => void;
};

const DEFAULT_USAGE: ImportUsage = { plan: "free", used: 0, limit: null, remaining: null };

export const ImportContext = createContext<ImportContextValue>({
  jobs: [],
  isProcessing: false,
  usage: DEFAULT_USAGE,
  startImport: () => {},
  removeJob: () => {},
  clearJobs: () => {},
});

export function useImportJobs() {
  return useContext(ImportContext);
}
