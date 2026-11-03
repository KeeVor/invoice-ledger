import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "./ui";
import {
  releaseNotesForUpdate,
  releaseNotesText,
} from "./releaseNotes";
import type { ReleaseNote } from "./types";

const sections: {
  key: "added" | "fixed" | "changed";
  label: string;
}[] = [
  { key: "added", label: "新增" },
  { key: "fixed", label: "修复" },
  { key: "changed", label: "行为变化" },
];

export function ReleaseNotesDialog({
  open,
  onOpenChange,
  currentVersion,
  latestVersion,
  fallbackNotes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: string;
  latestVersion: string;
  fallbackNotes?: string;
}) {
  const [releases, setReleases] = useState<ReleaseNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    setError("");
    setReleases([]);
    window.ledger
      .releaseNotes()
      .then((history) => {
        if (!stale)
          setReleases(
            releaseNotesForUpdate(
              history,
              currentVersion,
              latestVersion,
            ),
          );
      })
      .catch(() => {
        if (!stale) setError("暂时无法加载历史版本说明");
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [open, currentVersion, latestVersion, attempt]);

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="modal-backdrop" />
        <DialogContent
          className="release-notes-dialog"
          aria-labelledby="release-notes-title"
          aria-describedby={undefined}
        >
          <header className="release-notes-header">
            <div>
              <span className="release-notes-kicker">版本更新</span>
              <DialogTitle id="release-notes-title">更新内容</DialogTitle>
              <p>
                v{currentVersion} <span>→</span> v{latestVersion}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="关闭更新内容"
              onClick={() => onOpenChange(false)}
            >
              <X size={21} />
            </button>
          </header>
          <div className="release-notes-body">
            {loading ? (
              <div className="release-notes-state">
                <LoaderCircle className="spin" size={23} />
                正在加载版本说明
              </div>
            ) : releases.length ? (
              releases.map((release, index) => (
                <section className="release-version" key={release.version}>
                  <div className="release-version-heading">
                    <h3>v{release.version}</h3>
                    {index === 0 && <span>将安装</span>}
                  </div>
                  {sections.map(({ key, label }) =>
                    release[key].length ? (
                      <div className="release-change-group" key={key}>
                        <strong>{label}</strong>
                        <ul>
                          {release[key].map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </section>
              ))
            ) : (
              <section className="release-version">
                <div className="release-version-heading">
                  <h3>v{latestVersion}</h3>
                  <span>最新版本</span>
                </div>
                {error && (
                  <p className="release-notes-warning">{error}</p>
                )}
                {fallbackNotes ? (
                  <pre className="release-notes-fallback">
                    {releaseNotesText(fallbackNotes)}
                  </pre>
                ) : (
                  <div className="release-notes-state">
                    <p>暂时无法加载版本说明。</p>
                    <button
                      className="button secondary small"
                      onClick={() => setAttempt((value) => value + 1)}
                    >
                      <RefreshCw size={15} />
                      重试
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
          <footer className="release-notes-footer">
            {error && (
              <button
                className="text-button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                <RefreshCw size={14} />
                重新加载
              </button>
            )}
            <button
              className="button secondary small"
              onClick={() => void window.ledger.openReleases()}
            >
              <ArrowUpRight size={15} />
              查看完整发布记录
            </button>
          </footer>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
