import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  LedgerAPI,
  ImportProgress,
  ConfirmationRequest,
  UpdateState,
} from "../src/types";

const api: LedgerAPI = {
  updateState: () => ipcRenderer.invoke("update-state"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  openReleases: () => ipcRenderer.invoke("open-releases"),
  onUpdate: (callback) => {
    const handler = (_: unknown, state: UpdateState) => callback(state);
    ipcRenderer.on("update-state-changed", handler);
    return () => ipcRenderer.removeListener("update-state-changed", handler);
  },
  info: () => ipcRenderer.invoke("info"),
  chooseFiles: () => ipcRenderer.invoke("choose-files"),
  pathsForFiles: (files) =>
    files.map((f) => webUtils.getPathForFile(f)).filter(Boolean),
  importFiles: (paths) => ipcRenderer.invoke("import-files", paths),
  cancelImport: () => ipcRenderer.invoke("cancel-import"),
  onProgress: (callback) => {
    const handler = (_: unknown, data: ImportProgress) => callback(data);
    ipcRenderer.on("import-progress", handler);
    return () => ipcRenderer.removeListener("import-progress", handler);
  },
  onConfirm: (callback) => {
    const handler = (_: unknown, data: ConfirmationRequest) => callback(data);
    ipcRenderer.on("ui-confirm", handler);
    return () => ipcRenderer.removeListener("ui-confirm", handler);
  },
  respondConfirm: (id, confirmed) =>
    ipcRenderer.invoke("ui-confirm-result", id, confirmed),
  onNotice: (callback) => {
    const handler = (_: unknown, message: string) => callback(message);
    ipcRenderer.on("ui-notice", handler);
    return () => ipcRenderer.removeListener("ui-notice", handler);
  },
  drafts: () => ipcRenderer.invoke("drafts"),
  discardDraft: (id) => ipcRenderer.invoke("discard-draft", id),
  verifyDrafts: (ids, attribution) =>
    ipcRenderer.invoke("verify-drafts", ids, attribution),
  saveDraft: (id, fields) => ipcRenderer.invoke("save-draft", id, fields),
  checkDuplicate: (number, code) =>
    ipcRenderer.invoke("check-duplicate", number, code),
  list: (filter) => ipcRenderer.invoke("list", filter),
  getInvoice: (id) => ipcRenderer.invoke("get-invoice", id),
  updateInvoice: (id, fields) =>
    ipcRenderer.invoke("update-invoice", id, fields),
  permanentlyDeleteInvoice: (id) =>
    ipcRenderer.invoke("permanently-delete-invoice", id),
  archiveInvoice: (id, archived) =>
    ipcRenderer.invoke("archive-invoice", id, archived),
  stats: (month, dateBasis) => ipcRenderer.invoke("stats", month, dateBasis),
  preview: (kind, id) => ipcRenderer.invoke("preview", kind, id),
  openOriginal: (kind, id) => ipcRenderer.invoke("open-original", kind, id),
  exportExcel: (filter) => ipcRenderer.invoke("export-excel", filter),
  backup: () => ipcRenderer.invoke("backup"),
  restore: () => ipcRenderer.invoke("restore"),
  openDataDir: () => ipcRenderer.invoke("open-data-dir"),
};
contextBridge.exposeInMainWorld("ledger", api);
