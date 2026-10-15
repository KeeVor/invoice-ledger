import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import type { UpdateState, UpdateStatus } from "./types";
import { userError } from "./messages";

const labels: Record<UpdateStatus, string> = {
  disabled: "应用内更新未启用",
  idle: "随时检查新版本",
  checking: "正在检查新版本…",
  available: "发现新版本",
  "not-available": "当前已是最新版本",
  downloading: "正在下载更新…",
  downloaded: "更新已下载，等待安装",
  installing: "正在打开安装程序…",
  error: "暂时未能完成更新",
};

export function UpdatePanel({ version, blocked }: { version?: string; blocked: boolean }) {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!window.ledger) return;
    let received = false;
    let stale = false;
    const unsubscribe = window.ledger.onUpdate((next) => {
      received = true;
      setState(next);
    });
    window.ledger.updateState().then((next) => {
      if (!stale && !received) setState(next);
    }).catch((e) => { if (!stale) setError(userError(e)); });
    return () => { stale = true; unsubscribe(); };
  }, []);

  async function action(kind: "check" | "download" | "install" | "releases") {
    setPending(true);
    setError("");
    try {
      if (kind === "check") await window.ledger.checkForUpdates();
      if (kind === "download") await window.ledger.downloadUpdate();
      if (kind === "install") await window.ledger.installUpdate();
      if (kind === "releases") await window.ledger.openReleases();
    } catch (e) {
      setError(userError(e));
    } finally {
      setPending(false);
    }
  }
  const working = pending || ["checking", "downloading", "installing"].includes(state.status);
  return (
    <section className="settings-card update-card" aria-labelledby="update-heading">
      <div className="settings-icon"><RefreshCw size={25} /></div>
      <h2 id="update-heading">让票迹，保持新鲜</h2>
      <p>新版本通过 GitHub Releases 发布。只检查版本信息，不上传账本或发票；下载和安装都由你决定。</p>
      <div className="setting-row"><span>当前版本</span><strong>v{version ?? "…"}</strong></div>
      <div className="setting-row" role="status" aria-live="polite">
        <span>更新状态</span><strong>{labels[state.status]}{state.version ? ` · v${state.version}` : ""}</strong>
      </div>
      {state.checkedAt && <p className="subtle">最近检查：{new Date(state.checkedAt).toLocaleString("zh-CN", { hour12: false })}</p>}
      {state.status === "downloading" && (
        <div className="update-progress">
          <progress aria-label="更新下载进度" value={state.percent ?? 0} max={100} />
          <span>{(state.percent ?? 0).toFixed(1)}%</span>
        </div>
      )}
      {state.releaseNotes && <details className="update-notes"><summary>本次更新内容</summary><pre>{state.releaseNotes}</pre></details>}
      {(state.message || error) && <p className={error || state.status === "error" ? "negative" : "subtle"} role={error || state.status === "error" ? "alert" : undefined}>{error || state.message}</p>}
      <div className="backup-actions">
        {["idle", "not-available", "error", "checking"].includes(state.status) && (
          <button className="button secondary" disabled={working || blocked} onClick={() => void action("check")}>
            {working ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}检查更新
          </button>
        )}
        {state.status === "available" && <button className="button primary" disabled={working || blocked} onClick={() => void action("download")}><ArrowDownToLine size={17} />下载更新</button>}
        {state.status === "downloaded" && <button className="button primary" disabled={working || blocked} onClick={() => void action("install")}>{pending ? <LoaderCircle size={17} className="spin" /> : <RefreshCw size={17} />}安装更新并退出</button>}
        <button className="button secondary" disabled={pending} onClick={() => void action("releases")}><ArrowUpRight size={17} />发布页面</button>
      </div>
      <p className="subtle">安装前自动创建完整备份。当前安装包尚未签名，Windows 可能提示未知发布者，请核对发布来源。</p>
    </section>
  );
}
