import type { UpdateState } from "../src/types";

export const RELEASES_URL = "https://github.com/KeeVor/invoice-ledger/releases";
export const RELEASE_NOTES_URL =
  "https://github.com/KeeVor/invoice-ledger/releases/latest/download/release-notes.json";

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export class UpdateService {
  private state: UpdateState;
  private installing = false;

  constructor(
    private updater: UpdaterAdapter,
    enabled: boolean,
    private changed: (state: UpdateState) => void,
    private prepareInstall: () => Promise<boolean>,
  ) {
    this.state = enabled
      ? { status: "idle" }
      : { status: "disabled", message: "请使用 Windows 安装版启用应用内更新；开发和免安装目录不执行更新。" };
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.on("update-available", (info) => {
      if (this.state.status !== "checking") return;
      const notes = typeof info.releaseNotes === "string"
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map((n: { note?: string }) => n.note ?? "").join("\n")
          : "";
      this.set({
        status: "available",
        version: String(info.version),
        releaseNotes: notes.slice(0, 12000),
        checkedAt: new Date().toISOString(),
      });
    });
    updater.on("update-not-available", () => {
      if (this.state.status === "checking")
        this.set({ status: "not-available", checkedAt: new Date().toISOString() });
    });
    updater.on("download-progress", (progress) => {
      if (this.state.status !== "downloading") return;
      const percent = Number(progress.percent);
      this.set({ ...this.state, percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0 });
    });
    updater.on("update-downloaded", () => {
      if (this.state.status === "downloading")
        this.set({ ...this.state, status: "downloaded", percent: 100 });
    });
    updater.on("error", () => {
      if (["checking", "downloading", "installing"].includes(this.state.status))
        this.failed();
    });
  }

  snapshot(): UpdateState {
    return { ...this.state };
  }

  private set(state: UpdateState) {
    this.state = state;
    this.changed(this.snapshot());
  }

  private failed() {
    this.set({
      ...this.state,
      status: "error",
      message: "更新未完成，请检查网络和可用空间后重试。也可前往发布页面下载安装包；现有账本不受影响。",
    });
  }

  async check() {
    if (["disabled", "checking", "downloading", "downloaded", "installing"].includes(this.state.status) || this.installing)
      return this.snapshot();
    this.set({ status: "checking" });
    try {
      await this.updater.checkForUpdates();
      if (this.state.status === "checking") this.failed();
    } catch {
      this.failed();
    }
    return this.snapshot();
  }

  async download() {
    if (this.state.status !== "available") return this.snapshot();
    this.set({ ...this.state, status: "downloading", percent: 0, message: undefined });
    try {
      await this.updater.downloadUpdate();
    } catch {
      this.failed();
    }
    return this.snapshot();
  }

  async install() {
    if (this.state.status !== "downloaded" || this.installing) return;
    this.installing = true;
    try {
      // The owner confirms and blocks writes before allowing shutdown.
      if (!(await this.prepareInstall())) return;
      this.set({ ...this.state, status: "installing" });
      try {
        this.updater.quitAndInstall(false, true);
      } catch {
        this.failed();
      }
    } finally {
      this.installing = false;
    }
  }
}
