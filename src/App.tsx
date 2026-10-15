import { useCallback, useEffect, useRef, useState } from "react";
import { recognitionNotice, userError as errorText } from "./messages";
import logo from "./assets/piaoji.svg";
import { UpdatePanel } from "./UpdatePanel";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Archive,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Database,
  FileCheck2,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Inbox,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldX,
  SlidersHorizontal,
  UploadCloud,
  X,
  ZoomIn,
  AlertTriangle,
  RotateCcw,
  LayoutGrid,
  ReceiptText,
} from "lucide-react";
import {
  GlassSelect,
  MonthPicker,
  DateField,
  ConfirmDialog,
  Hint,
  TooltipProvider,
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
} from "./ui";
import type {
  AppInfo,
  Draft,
  Duplicate,
  Fields,
  Filter,
  ImportProgress,
  Invoice,
  Stats,
  StatsDateBasis,
  AmountTotals,
  ConfirmationRequest,
} from "./types";

type Page = "ledger" | "inbox" | "reports" | "settings";
type Selection =
  | { kind: "draft"; value: Draft }
  | { kind: "invoice"; value: Invoice };
const money = (cents: number | null | undefined) =>
  cents == null
    ? "—"
    : (cents / 100).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });
const localDay = () =>
  new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
const NAV = [
  { id: "ledger" as const, label: "发票台账", icon: LayoutGrid },
  { id: "inbox" as const, label: "导入与核对", icon: Inbox },
  { id: "reports" as const, label: "统计汇总", icon: BarChart3 },
  { id: "settings" as const, label: "数据与备份", icon: Settings2 },
];

export default function App() {
  const [page, setPage] = useState<Page>("ledger");
  const [info, setInfo] = useState<AppInfo>();
  const [stats, setStats] = useState<Stats>();
  const [ledgerStats, setLedgerStats] = useState<Stats>();
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [filter, setFilter] = useState<Filter>({ page: 1 });
  const [rows, setRows] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<AmountTotals>({
    amountCents: 0,
    taxCents: 0,
    totalCents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<Selection>();
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>();
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reportMonth, setReportMonth] = useState("");
  const [reportDateBasis, setReportDateBasis] =
    useState<StatsDateBasis>("invoiceDate");
  const reportTimeLabel = reportDateBasis === "createdAt" ? "录入" : "开票";
  const [report, setReport] = useState<Stats>();
  const [hasUpdate, setHasUpdate] = useState(false);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const refresh = () => setRevision((r) => r + 1);
  const startupErrorShown = useRef(false);

  useEffect(() => {
    if (!window.ledger) {
      notify("请打开电脑上的票迹软件，继续管理发票。", true);
      setLoading(false);
      return;
    }
    let stale = false;
    Promise.all([
      window.ledger.info(),
      window.ledger.stats(),
      window.ledger.drafts(),
    ])
      .then(([i, s, d]) => {
        if (!stale) {
          setInfo(i);
          setStats(s);
          setDrafts(d);
        }
      })
      .catch((e) => {
        if (!startupErrorShown.current) {
          notify(errorText(e), true);
          startupErrorShown.current = true;
        }
      });
    return () => {
      stale = true;
    };
  }, [revision, notify]);
  useEffect(() => {
    if (!window.ledger) return;
    let stale = false;
    setLoading(true);
    const timer = setTimeout(() => {
      window.ledger
        .list(filter)
        .then((r) => {
          if (!stale) {
            setRows(r.items);
            setTotal(r.total);
            setTotals(r.totals);
          }
        })
        .catch((e) => notify(errorText(e), true))
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 140);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [filter, revision, notify]);
  useEffect(() => {
    if (!window.ledger) return;
    let stale = false;
    setReport(undefined);
    window.ledger
      .stats(reportMonth, reportDateBasis)
      .then((s) => {
        if (!stale) setReport(s);
      })
      .catch((e) => notify(errorText(e), true));
    return () => {
      stale = true;
    };
  }, [reportMonth, reportDateBasis, revision, notify]);
  useEffect(() => window.ledger?.onProgress(setProgress), []);
  useEffect(
    () => window.ledger?.onUpdate((state) => {
      setHasUpdate(["available", "downloading", "downloaded"].includes(state.status));
      if (state.status === "available")
        notify(`发现票迹 v${state.version}，可在“数据与备份”中下载更新。`);
    }),
    [notify],
  );
  useEffect(() => window.ledger?.onConfirm(setConfirmation), []);
  useEffect(
    () => window.ledger?.onNotice((message) => notify(message, true)),
    [notify],
  );
  useEffect(() => {
    if (!window.ledger) return;
    let stale = false;
    window.ledger
      .stats(filter.month)
      .then((value) => {
        if (!stale) setLedgerStats(value);
      })
      .catch((error) => notify(errorText(error), true));
    return () => {
      stale = true;
    };
  }, [filter.month, revision, notify]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !selection &&
        !confirmation
      ) {
        event.preventDefault();
        setPage("ledger");
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>('[aria-label="搜索发票"]')
            ?.focus(),
        );
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [selection, confirmation]);
  useEffect(() => {
    if (!toast) return;
    if (toast.error) return;
    const timer = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function importPaths(paths: string[]) {
    if (!paths.length || importing || busy) return;
    setPage("inbox");
    setImporting(true);
    setProgress(undefined);
    setImportErrors([]);
    try {
      const result = await window.ledger.importFiles(paths);
      setImportErrors(result.errors);
      notify(
        `已识别 ${result.count} 张发票，请核对${result.errors.length ? `；${result.errors.length} 个文件未完成` : ""}`,
        result.errors.length > 0,
      );
      refresh();
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setImporting(false);
      setProgress(undefined);
    }
  }
  async function choose() {
    try {
      await importPaths(await window.ledger.chooseFiles());
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  async function viewInvoice(id: string) {
    try {
      const invoice = await window.ledger.getInvoice(id);
      if (invoice) setSelection({ kind: "invoice", value: invoice });
      else notify("记录不存在", true);
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  async function exportExcel() {
    setBusy(true);
    try {
      const p = await window.ledger.exportExcel(filter);
      if (p) notify("Excel 已导出");
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function backup(restore = false) {
    setBusy(true);
    try {
      const result = restore
        ? await window.ledger.restore()
        : await window.ledger.backup();
      if (result) {
        notify(restore ? "备份恢复成功" : "完整备份已保存（包含原件）");
        setSelection(undefined);
        refresh();
      }
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setBusy(false);
    }
  }
  const setQuery = (patch: Filter) =>
    setFilter((f) => ({ ...f, ...patch, page: 1 }));
  const hasFilter = !!(
    filter.search ||
    filter.month ||
    filter.category ||
    filter.archived
  );

  return (
    <TooltipProvider delayDuration={450} skipDelayDuration={120}>
      <div
        className="app-shell"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.relatedTarget) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (selection || confirmation) {
            notify("请先关闭核对窗口再拖入文件");
            return;
          }
          const paths = window.ledger.pathsForFiles(
            Array.from(e.dataTransfer.files),
          );
          void importPaths(paths);
        }}
      >
        <header className="app-header">
          <div className="brand">
            <img className="brand-mark" src={logo} alt="" draggable={false} />
            <div>
              <strong>票迹</strong>
              <small>让记录，轻一点。</small>
            </div>
          </div>
          <nav className="glass-navigation" aria-label="主导航">
            {NAV.map((n) => (
              <button
                key={n.id}
                className={`nav-item ${page === n.id ? "active" : ""}`}
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.id === "inbox" && !!drafts.length && <b>{drafts.length}</b>}
                {n.id === "settings" && hasUpdate && <b>新</b>}
              </button>
            ))}
          </nav>
          <div className="profile">
            <span className="local-status">
              <i className="status-dot" />
              我的账本
            </span>
          </div>
        </header>

        <main className="main-content">
          <header className="topbar">
            <div className="today">{localDay()}</div>
          </header>
          <div className="page-content" key={page}>
            <div className="page-heading">
              <div>
                <h1>{NAV.find((n) => n.id === page)?.label}</h1>
                <p>
                  {page === "ledger"
                    ? "每一张发票，都有迹可循。"
                    : page === "inbox"
                      ? "把文件交给票迹，把最后一次确认留给你。"
                      : page === "reports"
                        ? "换一个维度，看清每一笔记录。"
                        : "重要的不只是记下来，还要妥善留存。"}
                </p>
              </div>
              <div className="heading-actions">
                {page === "ledger" && (
                  <MonthPicker
                    label="开票月份筛选"
                    value={filter.month ?? ""}
                    onChange={(month) => setQuery({ month })}
                  />
                )}
                {page !== "settings" && (
                  <button
                    className="button primary"
                    onClick={choose}
                    disabled={importing || busy}
                  >
                    <Plus size={19} />
                    导入发票
                  </button>
                )}
              </div>
            </div>

            {page === "ledger" && (
              <>
                <div className="metrics ledger-metrics">
                  <section className="metric featured">
                    <div className="metric-label">
                      <span>
                        {filter.month ? "所选月票面金额" : "全部票面金额"}
                      </span>
                      <ReceiptText size={19} />
                    </div>
                    <div className="metric-number">
                      <span className="currency">¥</span>
                      {money(ledgerStats?.totalCents ?? 0)}
                    </div>
                    <div className="metric-bottom">
                      <span>已记录发票的价税合计</span>
                    </div>
                  </section>
                  <section className="metric">
                    <div className="metric-label">
                      已记录发票
                      <FileCheck2 size={19} />
                    </div>
                    <div className="metric-number">
                      {ledgerStats?.count ?? 0}
                      <small>张</small>
                    </div>
                    <div className="metric-bottom">
                      <span className="mini-dot" />
                      原件与记录一一对应
                    </div>
                  </section>
                  <section className="metric">
                    <div className="metric-label">
                      待核对发票
                      <Inbox size={19} />
                    </div>
                    <div className="metric-number">
                      {drafts.length}
                      <small>张</small>
                    </div>
                    <button
                      className="metric-link"
                      onClick={() => setPage("inbox")}
                    >
                      {drafts.length
                        ? "核对后记入台账"
                        : "新的发票，从这里开始"}
                      <ArrowRight size={15} />
                    </button>
                  </section>
                  <section className="metric">
                    <div className="metric-label">
                      重复已拦截
                      <ShieldCheck size={19} />
                    </div>
                    <div className="metric-number">
                      {stats?.duplicates ?? 0}
                      <small>次</small>
                    </div>
                    <div className="metric-bottom">
                      全部导入记录 · 未重复计入
                    </div>
                  </section>
                </div>
                <div className="ledger-layout">
                  <div className="ledger-main">
                    <section className="ledger-panel">
                      <div className="panel-heading">
                        <h2>
                          {filter.archived ? "归档记录" : "全部记录"}{" "}
                          <span>{total}</span>
                        </h2>
                        <div className="safe-label">
                          <ShieldCheck size={14} />
                          自动检查重复发票
                        </div>
                      </div>
                      <div className="filters">
                        <label className="search-box">
                          <Search size={17} />
                          <input
                            aria-label="搜索发票"
                            placeholder="搜索票号、单位、项目或备注…"
                            autoComplete="off"
                            spellCheck={false}
                            value={filter.search ?? ""}
                            onChange={(e) =>
                              setQuery({ search: e.target.value })
                            }
                          />
                        </label>
                        <GlassSelect
                          label="业务分类筛选"
                          value={filter.category ?? ""}
                          onChange={(category) => setQuery({ category })}
                          options={[
                            { value: "", label: "全部分类" },
                            ...(info?.categories ?? []).map((category) => ({
                              value: category,
                              label: category,
                            })),
                          ]}
                        />
                        <button
                          className="button secondary small export-button"
                          disabled={busy || !total}
                          onClick={exportExcel}
                        >
                          <ArrowDownToLine size={16} />
                          导出 Excel
                        </button>
                        <Hint
                          label={
                            filter.archived ? "返回有效记录" : "查看已归档记录"
                          }
                        >
                          <button
                            className={`icon-button ${filter.archived ? "selected" : ""}`}
                            aria-label="切换归档记录"
                            onClick={() =>
                              setQuery({ archived: !filter.archived })
                            }
                          >
                            <Archive size={18} />
                          </button>
                        </Hint>
                        {hasFilter && (
                          <button
                            className="text-button"
                            onClick={() => setFilter({ page: 1 })}
                          >
                            重置
                          </button>
                        )}
                      </div>
                      {filter.archived && (
                        <div className="inline-note">
                          已归档的发票不计入统计，再次导入仍会提示重复。
                        </div>
                      )}
                      <div className="table-wrap">
                        <table aria-label="发票台账" aria-busy={loading}>
                          <colgroup>
                            <col style={{ width: "24%" }} />
                            <col style={{ width: "25%" }} />
                            <col style={{ width: "10%" }} />
                            <col style={{ width: "12%" }} />
                            <col style={{ width: "10%" }} />
                            <col style={{ width: "13%" }} />
                            <col style={{ width: "6%" }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>发票号码 / 开票日期</th>
                              <th>销售方 / 项目</th>
                              <th>分类</th>
                              <th className="align-right">不含税金额</th>
                              <th className="align-right">税额</th>
                              <th className="align-right">价税合计</th>
                              <th className="align-right">操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr
                                key={r.id}
                                onClick={(event) => {
                                  event.currentTarget
                                    .querySelector("button")
                                    ?.focus({ preventScroll: true });
                                  setSelection({ kind: "invoice", value: r });
                                }}
                              >
                                <td>
                                  <div className="invoice-cell">
                                    <span
                                      className={`file-tile ${/\.pdf$/i.test(r.originalName) ? "" : "image"}`}
                                    >
                                      <FileText size={15} />
                                      <small>
                                        {/\.pdf$/i.test(r.originalName)
                                          ? "PDF"
                                          : "IMG"}
                                      </small>
                                    </span>
                                    <div>
                                      <span className="invoice-no">
                                        {r.invoiceNumber}
                                      </span>
                                      <small>{r.invoiceDate}</small>
                                    </div>
                                  </div>
                                </td>
                                <td className="company-cell">
                                  <strong title={r.sellerName}>
                                    {r.sellerName || "未填写销售方"}
                                  </strong>
                                  <small title={r.itemName}>
                                    {r.itemName || "未填写项目"}
                                  </small>
                                </td>
                                <td>
                                  <span
                                    className={`category-tag ${r.category === "未分类" ? "muted" : ""}`}
                                  >
                                    {r.category}
                                  </span>
                                </td>
                                <td
                                  className={`amount amount-detail align-right ${r.amountCents! < 0 ? "negative" : ""}`}
                                >
                                  ¥ {money(r.amountCents)}
                                </td>
                                <td
                                  className={`amount amount-detail align-right ${r.taxCents! < 0 ? "negative" : ""}`}
                                >
                                  ¥ {money(r.taxCents)}
                                </td>
                                <td
                                  className={`amount align-right ${r.totalCents! < 0 ? "negative" : ""}`}
                                >
                                  ¥ {money(r.totalCents)}
                                </td>
                                <td className="align-right">
                                  <button
                                    className="row-action"
                                    aria-label={`查看发票 ${r.invoiceNumber}`}
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {!filter.archived && (
                            <tfoot>
                              <tr>
                                <th scope="row" colSpan={3}>
                                  {hasFilter ? "筛选结果合计" : "全部记录合计"}
                                  <small>包含全部分页</small>
                                </th>
                                {[
                                  totals.amountCents,
                                  totals.taxCents,
                                  totals.totalCents,
                                ].map((value, index) => (
                                  <td
                                    key={index}
                                    className={`amount align-right ${value < 0 ? "negative" : ""}`}
                                  >
                                    {loading ? "—" : `¥ ${money(value)}`}
                                  </td>
                                ))}
                                <td />
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                      {!rows.length && (
                        <div className="empty-ledger">
                          <div className="empty-art">
                            <div className="paper back" />
                            <div className="paper front">
                              <div className="paper-head">
                                <FileText size={19} />
                                <span>INVOICE</span>
                              </div>
                              <i />
                              <i />
                              <div className="paper-total">
                                ¥ <span>0.00</span>
                              </div>
                              <div className="paper-check">
                                <Check size={16} />
                              </div>
                            </div>
                            <span className="art-spark">+</span>
                          </div>
                          <h3>
                            {loading
                              ? "正在读取台账…"
                              : hasFilter
                                ? "没有找到匹配的发票"
                                : "第一张发票，从这里开始"}
                          </h3>
                          <p>
                            {hasFilter
                              ? "试试其他关键词，或调整分类与月份。"
                              : "导入 PDF 或图片，核对后即可保存，重复发票会自动提醒。"}
                          </p>
                          <button
                            className="button primary"
                            onClick={
                              hasFilter ? () => setFilter({ page: 1 }) : choose
                            }
                            disabled={importing || busy}
                          >
                            {hasFilter ? (
                              <RotateCcw size={16} />
                            ) : (
                              <Plus size={17} />
                            )}
                            {hasFilter ? "清除筛选" : "导入第一张发票"}
                          </button>
                          <span className="empty-formats">
                            PDF / JPG / PNG · 自动保留原件
                          </span>
                        </div>
                      )}
                      <div className="table-footer">
                        <span>
                          {loading && rows.length
                            ? "更新中…"
                            : `共 ${total} 条记录`}
                          {!!rows.length && " · 每页 50 条"}
                        </span>
                        <div>
                          <button
                            className="icon-button"
                            aria-label="上一页"
                            disabled={(filter.page ?? 1) <= 1}
                            onClick={() =>
                              setFilter((f) => ({
                                ...f,
                                page: (f.page ?? 1) - 1,
                              }))
                            }
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span>
                            {filter.page ?? 1} /{" "}
                            {Math.max(1, Math.ceil(total / 50))}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="下一页"
                            disabled={(filter.page ?? 1) * 50 >= total}
                            onClick={() =>
                              setFilter((f) => ({
                                ...f,
                                page: (f.page ?? 1) + 1,
                              }))
                            }
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    </section>
                    <div className="footnote">
                      <CircleHelp size={14} />
                      统计只包含已确认的有效记录；未核对和归档记录不计入金额。
                    </div>
                  </div>
                  <LedgerAside
                    stats={ledgerStats}
                    info={info}
                    month={filter.month}
                    onReports={() => setPage("reports")}
                    onSettings={() => setPage("settings")}
                  />
                </div>
              </>
            )}

            {page === "inbox" && (
              <>
                <section className={`dropzone ${importing ? "working" : ""}`}>
                  <div className="drop-visual">
                    {importing ? (
                      <LoaderCircle className="spin" size={36} />
                    ) : (
                      <UploadCloud size={36} strokeWidth={1.4} />
                    )}
                  </div>
                  <div>
                    <h2>
                      {importing
                        ? "正在为发票建立档案"
                        : "拖入发票，剩下的交给票迹"}
                    </h2>
                    <p>
                      {importing
                        ? `${progress?.current ?? 0} / ${progress?.total ?? "—"} · ${progress?.filename ?? "正在准备…"}`
                        : "支持批量导入 PDF、截图和照片，发票不会上传到网上。"}
                    </p>
                    <div className="format-tags">
                      <span>PDF</span>
                      <span>JPG / PNG</span>
                      <span>单文件 ≤ 50 MB</span>
                    </div>
                  </div>
                  <button
                    className={`button ${importing ? "secondary" : "primary"}`}
                    disabled={busy}
                    onClick={
                      importing
                        ? () =>
                            window.ledger
                              .cancelImport()
                              .catch((e) => notify(errorText(e), true))
                        : choose
                    }
                  >
                    {importing ? (
                      <>
                        <X size={16} />
                        取消任务
                      </>
                    ) : (
                      <>
                        <FolderOpen size={17} />
                        选择文件
                      </>
                    )}
                  </button>
                  {importing && (
                    <div className="progress-track">
                      <div
                        style={{
                          width: `${Math.max(5, (((progress?.current ?? 0) - 1) / (progress?.total ?? 1)) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </section>
                <div className="workflow-strip">
                  <span>
                    <b>01</b>自动识别
                  </span>
                  <ArrowRight size={14} />
                  <span>
                    <b>02</b>检查是否重复
                  </span>
                  <ArrowRight size={14} />
                  <span>
                    <b>03</b>核对并保存
                  </span>
                  <div>多页 PDF 按页识别 · 一张图片请仅保留一张发票</div>
                </div>
                {!!importErrors.length && (
                  <div className="error-panel">
                    <strong>以下文件未完成识别，可调整文件后重试</strong>
                    {importErrors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                    <button
                      className="text-button"
                      onClick={() => setImportErrors([])}
                    >
                      收起
                    </button>
                  </div>
                )}
                <section className="queue-panel">
                  <div className="panel-heading">
                    <h2>
                      待核对发票 <span>{drafts.length}</span>
                    </h2>
                    <span className="subtle">核对前不会计入正式台账</span>
                  </div>
                  {!drafts.length ? (
                    <div className="queue-empty">
                      <FileSearch size={38} strokeWidth={1.2} />
                      <h3>这里还没有待核对的发票</h3>
                      <p>导入后，识别结果会出现在这里。关闭软件也会保留。</p>
                    </div>
                  ) : (
                    <div className="draft-list">
                      {drafts.map((d) => (
                        <div className="draft-row" key={d.id}>
                          <div
                            className={`draft-icon ${d.duplicate ? "duplicate" : ""}`}
                          >
                            {d.duplicate ? (
                              <ShieldX size={23} />
                            ) : (
                              <FileText size={23} />
                            )}
                          </div>
                          <div className="draft-name">
                            <strong title={d.originalName}>
                              {d.originalName}
                            </strong>
                            <span>
                              {d.invoiceNumber || "号码待填写"} <i>·</i> 第{" "}
                              {d.page} 页
                            </span>
                          </div>
                          <div className="draft-amount">
                            ¥ {money(d.totalCents)}
                            <small>{d.category}</small>
                          </div>
                          <span
                            className={`state-pill ${d.duplicate ? "danger" : "amber"}`}
                          >
                            {d.duplicate ? "已记录，请勿重复保存" : "请核对"}
                          </span>
                          <button
                            className="button secondary small"
                            onClick={() =>
                              setSelection({ kind: "draft", value: d })
                            }
                          >
                            核对
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {page === "reports" && (
              <>
                <div className="report-toolbar">
                  <span>按{reportTimeLabel}月份汇总已保存发票的金额与税额</span>
                  <GlassSelect
                    label="统计时间口径"
                    value={reportDateBasis}
                    onChange={(value) =>
                      setReportDateBasis(value as StatsDateBasis)
                    }
                    options={[
                      { value: "invoiceDate", label: "按开票时间" },
                      { value: "createdAt", label: "按录入时间" },
                    ]}
                  />
                  <MonthPicker
                    label="统计月份"
                    value={reportMonth}
                    onChange={setReportMonth}
                  />
                  {reportMonth && (
                    <button
                      className="text-button"
                      onClick={() => setReportMonth("")}
                    >
                      全部日期
                    </button>
                  )}
                </div>
                <div className="metrics report-metrics" aria-busy={!report}>
                  <section className="metric featured">
                    <div className="metric-label">
                      {reportMonth || "全部日期"} · 价税合计
                    </div>
                    <div className="metric-number">
                      <span className="currency">¥</span>
                      {money(report?.totalCents ?? 0)}
                    </div>
                    <div className="metric-bottom">
                      红字发票按票面负数金额计入
                    </div>
                  </section>
                  <section className="metric">
                    <div className="metric-label">不含税金额合计</div>
                    <div className="metric-number smaller">
                      <span className="currency">¥</span>
                      {money(report?.amountCents ?? 0)}
                    </div>
                    <div className="metric-bottom">
                      不含税金额 + 税额 = 价税合计
                    </div>
                  </section>
                  <section className="metric">
                    <div className="metric-label">
                      票面税额合计
                      <Database size={18} />
                    </div>
                    <div className="metric-number smaller">
                      <span className="currency">¥</span>
                      {money(report?.taxCents ?? 0)}
                    </div>
                    <div className="metric-bottom">不代表可抵扣税额</div>
                  </section>
                  <section className="metric">
                    <div className="metric-label">
                      发票数量
                      <FileText size={18} />
                    </div>
                    <div className="metric-number">
                      {report?.count ?? 0}
                      <small>张</small>
                    </div>
                    <div className="metric-bottom">
                      不包含待核对及已归档记录
                    </div>
                  </section>
                </div>
                <div className="report-grid">
                  <section className="report-card">
                    <div className="panel-heading">
                      <h2>按业务分类</h2>
                      <span className="subtle">价税合计 / 元</span>
                    </div>
                    {report?.categories.length ? (
                      <div className="bar-list">
                        {report.categories.map((r, i) => (
                          <div className="bar-row" key={r.category}>
                            <div>
                              <span>
                                <i
                                  style={{
                                    background:
                                      CHART_COLORS[i % CHART_COLORS.length],
                                  }}
                                />
                                {r.category}
                                <small>{r.count} 张</small>
                              </span>
                              <strong>{money(r.totalCents)}</strong>
                            </div>
                            <div className="bar-track">
                              <span
                                style={{
                                  width: `${Math.max(2, (Math.abs(r.totalCents) / Math.max(...report.categories.map((c) => Math.abs(c.totalCents)), 1)) * 100)}%`,
                                  background:
                                    CHART_COLORS[i % CHART_COLORS.length],
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyReport />
                    )}
                  </section>
                  <section className="report-card">
                    <div className="panel-heading">
                      <h2>按销售方</h2>
                      <span className="subtle">前 10 位</span>
                    </div>
                    {report?.sellers.length ? (
                      <div className="rank-list">
                        {report.sellers.map((r, i) => (
                          <div key={r.sellerName}>
                            <b>{String(i + 1).padStart(2, "0")}</b>
                            <span title={r.sellerName}>
                              {r.sellerName || "未填写销售方"}
                              <small>{r.count} 张发票</small>
                            </span>
                            <strong>¥ {money(r.totalCents)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyReport />
                    )}
                  </section>
                </div>
                <section className="report-card monthly">
                  <div className="panel-heading">
                    <h2>月度记录</h2>
                    <span className="subtle">
                      按{reportTimeLabel}时间 · 最近 12 个有记录的月份 ·
                      不受上方月份筛选影响
                    </span>
                  </div>
                  {report?.months.length ? (
                    <div className="monthly-table-wrap">
                      <table aria-label="月度记录">
                        <thead>
                          <tr>
                            <th>{reportTimeLabel}月份</th>
                            <th>发票数量</th>
                            <th className="align-right">不含税金额</th>
                            <th className="align-right">税额</th>
                            <th className="align-right">价税合计</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.months.map((r) => (
                            <tr key={r.month}>
                              <td>{r.month}</td>
                              <td>{r.count} 张</td>
                              <td
                                className={`amount align-right ${r.amountCents < 0 ? "negative" : ""}`}
                              >
                                ¥ {money(r.amountCents)}
                              </td>
                              <td
                                className={`amount align-right ${r.taxCents < 0 ? "negative" : ""}`}
                              >
                                ¥ {money(r.taxCents)}
                              </td>
                              <td
                                className={`amount align-right ${r.totalCents < 0 ? "negative" : ""}`}
                              >
                                ¥ {money(r.totalCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyReport />
                  )}
                </section>
                <div className="footnote">
                  <CircleHelp size={14} />
                  <span>
                    {reportDateBasis === "createdAt" &&
                      "录入时间以首次核对并保存为准，按本机时区统计；后续修改不改变录入时间。"}
                    此处汇总发票金额，不区分收入与支出，也不代表利润或已报销金额。每张发票按一个分类统计。
                  </span>
                </div>
              </>
            )}

            {page === "settings" && (
              <div className="settings-layout">
                <section className="settings-card">
                  <div className="settings-icon">
                    <FolderOpen size={25} />
                  </div>
                  <h2>发票文件，随时查看</h2>
                  <p>台账与发票原件保存在这台电脑里，方便随时查找。</p>
                  <div className="setting-row">
                    <span>保存位置</span>
                    <code>{info?.dataDir ?? "读取中…"}</code>
                    <button
                      className="button secondary small"
                      onClick={() =>
                        window.ledger
                          .openDataDir()
                          .catch((e) => notify(errorText(e), true))
                      }
                    >
                      <FolderOpen size={15} />
                      打开文件夹
                    </button>
                  </div>
                  <div className="setting-row">
                    <span>发票识别</span>
                    <strong
                      className={info?.engine ? "green-text" : "negative"}
                    >
                      {!info
                        ? "正在检查…"
                        : info.engine
                          ? "可正常使用"
                          : "暂不可用，请重新安装票迹"}
                    </strong>
                  </div>
                  <div className="setting-row">
                    <span>最近完整备份</span>
                    <strong>
                      {info?.lastBackup
                        ? time(info.lastBackup)
                        : "尚未创建备份"}
                    </strong>
                  </div>
                </section>
                <section className="settings-card backup-card">
                  <div className="settings-icon">
                    <ShieldCheck size={25} />
                  </div>
                  <h2>备份，是另一份安心</h2>
                  <p>
                    一份备份，保存全部台账和发票原件，方便恢复记录或更换电脑。
                  </p>
                  <div className="backup-actions">
                    <button
                      className="button primary"
                      disabled={busy || importing}
                      onClick={() => backup()}
                    >
                      {busy ? (
                        <LoaderCircle size={17} className="spin" />
                      ) : (
                        <ArrowDownToLine size={17} />
                      )}
                      创建完整备份
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || importing}
                      onClick={() => backup(true)}
                    >
                      <RefreshCw size={17} />
                      从备份恢复
                    </button>
                  </div>
                  <div className="backup-note">
                    <AlertTriangle size={18} />
                    <p>
                      恢复会替换当前台账和原件，不会另存恢复前的备份。请只使用可信的备份文件。
                    </p>
                  </div>
                  <p className="subtle">
                    修改记录后，正常退出票迹会自动备份，只保留最新 1
                    份；新备份创建并校验成功后才删除旧备份。手动导出的备份不自动删除，建议另存到其他硬盘。
                  </p>
                </section>
                <UpdatePanel version={info?.version} blocked={busy || importing} />
                <section className="privacy-note">
                  <ShieldCheck size={21} />
                  <div>
                    <strong>识别不等于验真，录入不等于报销。</strong>
                    <p>
                      票迹不提供发票验真或报销审批。账本和备份文件没有密码保护，请妥善保管电脑与备份，不要随意分享。
                    </p>
                    {info?.version && <p>票迹 v{info.version}</p>}
                  </div>
                </section>
              </div>
            )}
          </div>
        </main>
        {selection && (
          <Editor
            key={`${selection.kind}-${selection.value.id}`}
            selection={selection}
            categories={info?.categories ?? ["未分类"]}
            onClose={() => setSelection(undefined)}
            onSaved={() => {
              setSelection(undefined);
              refresh();
            }}
            notify={notify}
            viewInvoice={viewInvoice}
          />
        )}
        <ConfirmDialog
          open={!!confirmation}
          title={confirmation?.title ?? ""}
          description={confirmation?.description ?? ""}
          details={confirmation?.details}
          confirmLabel={confirmation?.confirmLabel}
          cancelLabel={confirmation?.cancelLabel}
          danger={confirmation?.danger}
          onCancel={() => {
            if (confirmation)
              void window.ledger
                .respondConfirm(confirmation.id, false)
                .catch((error) => notify(errorText(error), true));
            setConfirmation(undefined);
          }}
          onConfirm={() => {
            if (confirmation)
              void window.ledger
                .respondConfirm(confirmation.id, true)
                .catch((error) => notify(errorText(error), true));
            setConfirmation(undefined);
          }}
        />
        {dragging && (
          <div className="drag-overlay">
            <UploadCloud size={52} />
            <h2>松开鼠标，导入发票</h2>
            <p>PDF、图片都可以</p>
          </div>
        )}
        {toast && (
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
            aria-live={toast.error ? "assertive" : "polite"}
          >
            {toast.error ? <AlertTriangle size={20} /> : <Check size={20} />}
            <span>{toast.text}</span>
            <button aria-label="关闭提示" onClick={() => setToast(undefined)}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

const CHART_COLORS = [
  "#6494dd",
  "#94b7e9",
  "#83bbc5",
  "#a4b6d5",
  "#c4baa2",
  "#b8c8d9",
];
function LedgerAside({
  stats,
  info,
  month,
  onReports,
  onSettings,
}: {
  stats?: Stats;
  info?: AppInfo;
  month?: string;
  onReports: () => void;
  onSettings: () => void;
}) {
  const categories = stats?.categories ?? [];
  const negative = categories.some((category) => category.totalCents < 0);
  const groups =
    categories.length > 4
      ? [
          ...categories.slice(0, 4),
          {
            category: "其他分类",
            totalCents: categories
              .slice(4)
              .reduce((sum, category) => sum + category.totalCents, 0),
            count: 0,
          },
        ]
      : categories;
  const total = groups.reduce((sum, group) => sum + group.totalCents, 0);
  let start = 0;
  const stops = groups.map((group, index) => {
    const before = start;
    start += total ? (group.totalCents / total) * 100 : 0;
    return `${CHART_COLORS[index]} ${before}% ${start}%`;
  });
  return (
    <aside className="ledger-aside" aria-label="台账概览">
      <section className="overview-card">
        <div className="overview-heading">
          <h2>发票分类</h2>
          <span>{month ? `${Number(month.slice(5))} 月` : "全部月份"}</span>
        </div>
        <p className="subtle">按价税合计查看构成</p>
        <div
          className="category-ring"
          aria-hidden="true"
          style={{
            background:
              total > 0 && !negative
                ? `conic-gradient(${stops.join(",")})`
                : "#bfd0e2",
          }}
        >
          <div>
            <strong>{stats?.count ?? 0}</strong>
            <span>张已记录</span>
          </div>
        </div>
        {groups.length ? (
          <div className="category-list">
            {groups.map((group, index) => (
              <div key={group.category}>
                <i style={{ background: CHART_COLORS[index] }} />
                <span title={group.category}>{group.category}</span>
                <strong className={group.totalCents < 0 ? "negative" : ""}>
                  {money(group.totalCents)}
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="aside-empty">记录第一张发票后，分类会在这里汇总。</p>
        )}
        {negative && (
          <p className="aside-empty">
            含红字负数金额，不显示占比；金额按票面符号汇总。
          </p>
        )}
        <button className="aside-link" onClick={onReports}>
          查看分类明细
          <ArrowRight size={14} />
        </button>
      </section>
      <section className="overview-card">
        <div className="overview-heading">
          <h2>账本守护</h2>
          <ShieldCheck size={17} />
        </div>
        <div className="protection-item">
          <span className="protection-icon">
            <Check size={14} />
          </span>
          <div>
            <strong>同一张票，只记一次</strong>
            <p>已记录的发票再次导入时会提醒，不会重复计入金额。</p>
          </div>
        </div>
        <div className="protection-item">
          <span className="protection-icon">
            <Database size={14} />
          </span>
          <div>
            <strong>
              {info?.lastBackup ? "已有完整备份" : "记得为账本留一份备份"}
            </strong>
            <p>
              {info?.lastBackup
                ? time(info.lastBackup)
                : "台账与发票原件都保存在这台电脑里。"}
            </p>
          </div>
        </div>
        <button className="aside-link" onClick={onSettings}>
          数据与备份
          <ArrowRight size={14} />
        </button>
      </section>
    </aside>
  );
}

function EmptyReport() {
  return (
    <div className="report-empty">
      <BarChart3 size={30} strokeWidth={1.3} />
      <p>确认录入后，数据会在这里汇总。</p>
    </div>
  );
}
type EditFields = Omit<Fields, "amountCents" | "taxCents" | "totalCents"> & {
  amount: string;
  tax: string;
  total: string;
};
function toEdit(v: Fields): EditFields {
  return {
    ...v,
    amount: v.amountCents == null ? "" : (v.amountCents / 100).toFixed(2),
    tax: v.taxCents == null ? "" : (v.taxCents / 100).toFixed(2),
    total: v.totalCents == null ? "" : (v.totalCents / 100).toFixed(2),
  };
}
function toCents(value: string) {
  const v = value.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(v)) return null;
  const [whole, part = ""] = v.replace("-", "").split(".");
  const integer = BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
  const signed = v.startsWith("-") ? -integer : integer;
  return signed > 100000000000000n || signed < -100000000000000n
    ? null
    : Number(signed);
}

function Editor({
  selection,
  categories,
  onClose,
  onSaved,
  notify,
  viewInvoice,
}: {
  selection: Selection;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
  notify: (text: string, error?: boolean) => void;
  viewInvoice: (id: string) => void;
}) {
  const { value, kind } = selection;
  const [fields, setFields] = useState<EditFields>(() => toEdit(value));
  const [preview, setPreview] = useState<string | null>();
  const [previewError, setPreviewError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(
    kind === "draft" ? (selection.value.duplicate ?? null) : null,
  );
  const [raw, setRaw] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "discard" | "archive" | "close"
  >();
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  const modal = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestClose = useCallback(() => {
    if (!busy) changed ? setConfirmAction("close") : onClose();
  }, [busy, changed, onClose]);
  useEffect(() => {
    let stale = false;
    window.ledger
      .preview(kind, value.id)
      .then((v) => {
        if (!stale) setPreview(v);
      })
      .catch(() => {
        if (!stale) setPreviewError(true);
      });
    return () => {
      stale = true;
    };
  }, [kind, value.id]);
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(
      () =>
        window.ledger
          .checkDuplicate(fields.invoiceNumber, fields.invoiceCode)
          .then((d) => {
            if (!stale) setDuplicate(d?.id === value.id ? null : d);
          })
          .catch(() => {}),
      250,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [fields.invoiceNumber, fields.invoiceCode, value.id]);
  useEffect(() => {
    if (error)
      modal.current
        ?.querySelector(".form-error")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);
  const set = (key: keyof EditFields, text: string) => {
    setFields((f) => ({ ...f, [key]: text }));
    setChanged(true);
    setConfirmed(false);
    setError("");
  };
  const amount = toCents(fields.amount),
    tax = toCents(fields.tax),
    total = toCents(fields.total);
  const balanced =
    amount != null && tax != null && total != null && amount + tax === total;
  async function save() {
    if (kind === "draft" && !confirmed) {
      setError("请先核对原件，并勾选确认");
      return;
    }
    if (!balanced) {
      setError("请填写有效金额，且不含税金额 + 税额 = 价税合计");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: Fields = {
        ...fields,
        amountCents: amount,
        taxCents: tax,
        totalCents: total,
      };
      const result =
        kind === "draft"
          ? await window.ledger.saveDraft(value.id, payload)
          : await window.ledger.updateInvoice(value.id, payload);
      if (result.duplicate) {
        setDuplicate(result.duplicate);
        setError("这张发票已在台账中，不能重复保存");
      } else {
        notify(kind === "draft" ? "发票已记入台账，原件已保留" : "修改已保存");
        onSaved();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function executeAction() {
    if (confirmAction === "close") {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (confirmAction === "discard") {
        await window.ledger.discardDraft(value.id);
        notify("已移出待核对列表，已保存的发票不受影响");
      } else {
        await window.ledger.archiveInvoice(
          value.id,
          !(selection.kind === "invoice" && selection.value.archived),
        );
        notify(
          selection.kind === "invoice" && selection.value.archived
            ? "已恢复为有效记录"
            : "已归档，不再计入统计；再次导入仍会提示重复",
        );
      }
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setConfirmAction(undefined);
    }
  }
  const input = (
    label: string,
    key: keyof EditFields,
    options: { wide?: boolean; required?: boolean; type?: string } = {},
  ) => (
    <label className={`field ${options.wide ? "wide" : ""}`}>
      <span>
        {label}
        {options.required && <b>*</b>}
      </span>
      <input
        type={options.type ?? "text"}
        value={fields[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={options.required ? "请核对并填写" : "选填"}
        autoComplete="off"
        spellCheck={false}
      />
    </label>
  );
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="modal-backdrop" />
        <DialogContent
          className="editor"
          aria-labelledby="editor-title"
          aria-describedby={undefined}
          tabIndex={-1}
          ref={modal}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current?.isConnected
              ? returnFocus.current
              : document.querySelector<HTMLInputElement>(
                  '[aria-label="搜索发票"]',
                );
            target?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <header className="editor-header">
            <div>
              <DialogTitle id="editor-title">
                {kind === "draft" ? "核对这张发票" : "发票详情"}
                <span>第 {value.page} 页</span>
              </DialogTitle>
              <p className="editor-subtitle">
                {kind === "draft"
                  ? "对照原件核对，确认后计入台账。"
                  : "原件与记录，一起查看。"}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="关闭核对窗口"
              onClick={requestClose}
            >
              <X size={22} />
            </button>
          </header>
          <div className="editor-body">
            <div className="preview-pane">
              <div className="preview-toolbar">
                <span title={value.originalName}>
                  <FileText size={15} />
                  {value.originalName}
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    window.ledger
                      .openOriginal(kind, value.id)
                      .catch((e) => setError(errorText(e)))
                  }
                >
                  <ArrowUpRight size={15} />
                  打开原件
                </button>
              </div>
              <div className="preview-canvas">
                {preview ? (
                  <img
                    src={preview}
                    alt="发票原件预览"
                    style={{ width: `${zoom}%`, maxWidth: "none" }}
                  />
                ) : (
                  <div className="preview-placeholder">
                    {previewError || preview === null ? (
                      "预览不可用，请打开原件"
                    ) : (
                      <>
                        <LoaderCircle className="spin" size={25} />
                        正在加载预览
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="zoom-toolbar">
                <ZoomIn size={16} />
                <input
                  aria-label="预览缩放"
                  type="range"
                  min="70"
                  max="220"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
                <span>{zoom}%</span>
                <button className="text-button" onClick={() => setZoom(100)}>
                  适应宽度
                </button>
              </div>
            </div>
            <div className="form-pane">
              {duplicate && (
                <div className="duplicate-banner">
                  <ShieldX size={22} />
                  <div>
                    <strong>这张发票已经录过了</strong>
                    <p>
                      首次录入：{time(duplicate.createdAt)}
                      {duplicate.archived ? "（已归档，无需重复保存）" : ""}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => viewInvoice(duplicate.id)}
                    >
                      查看已有记录 <ArrowUpRight size={13} />
                    </button>
                  </div>
                </div>
              )}
              {selection.kind === "invoice" && !!selection.value.archived && (
                <div className="warning-banner">
                  这条记录已归档，不参与统计。可通过底部按钮恢复。
                </div>
              )}
              {kind === "draft" && (
                <div className="review-reminder">
                  <ShieldCheck size={16} />
                  识别结果仅作辅助，请对照左侧原件核对。
                </div>
              )}
              {selection.kind === "draft" &&
                selection.value.warnings.length > 0 && (
                  <details className="warnings">
                    <summary>
                      <AlertTriangle size={14} />
                      {selection.value.warnings.length} 项识别提示
                    </summary>
                    <ul>
                      {selection.value.warnings.map((w, i) => (
                        <li key={i}>{recognitionNotice(w)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              <div className="form-section-title">
                01 <strong>发票信息</strong>
              </div>
              <div className="form-grid">
                {input("发票号码", "invoiceNumber", {
                  wide: true,
                  required: true,
                })}
                {input("发票代码（旧版必填）", "invoiceCode")}
                <DateField
                  label="开票日期"
                  value={fields.invoiceDate}
                  onChange={(next) => set("invoiceDate", next)}
                />
                {input("发票类型", "invoiceType")}
                <div className="field">
                  <span>
                    业务分类<b>*</b>
                  </span>
                  <GlassSelect
                    label="业务分类"
                    value={fields.category}
                    onChange={(next) => set("category", next)}
                    options={Array.from(
                      new Set([...categories, fields.category]),
                    ).map((category) => ({
                      value: category,
                      label: category || "未分类",
                    }))}
                  />
                </div>
                {input("票面项目", "itemName", { wide: true })}
              </div>
              <div className="form-section-title">
                02 <strong>购销双方</strong>
              </div>
              <div className="form-grid">
                {input("购买方名称", "buyerName", { wide: true })}
                {input("销售方名称", "sellerName", { wide: true })}
                {input("购买方税号", "buyerTaxId", { wide: true })}
                {input("销售方税号", "sellerTaxId", { wide: true })}
              </div>
              <div className="form-section-title">
                03 <strong>票面金额</strong>
                <span>单位：元</span>
              </div>
              <div className="money-fields">
                {input("不含税金额", "amount", { required: true })}
                {input("税额", "tax", { required: true })}
                {input("价税合计", "total", { required: true })}
              </div>
              <div className={`balance-note ${balanced ? "ok" : ""}`}>
                {balanced ? <Check size={13} /> : <AlertTriangle size={13} />}
                {balanced
                  ? "不含税金额与税额之和等于价税合计"
                  : "请确认不含税金额 + 税额 = 价税合计"}
              </div>
              <label className="field notes-field">
                <span>备注</span>
                <textarea
                  rows={2}
                  value={fields.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="可记录用途、经办人或其他补充信息"
                />
              </label>
              {selection.kind === "invoice" && (
                <p className="record-timestamp">
                  录入时间：
                  <time dateTime={selection.value.createdAt}>
                    {time(selection.value.createdAt)}
                  </time>
                </p>
              )}
              {selection.kind === "draft" && (
                <>
                  <button
                    className="text-button raw-toggle"
                    onClick={() => setRaw(!raw)}
                  >
                    {raw ? "收起" : "查看"}识别文字
                  </button>
                  {raw && (
                    <pre className="raw-text">{selection.value.rawText}</pre>
                  )}
                </>
              )}
              {kind === "draft" && (
                <label className="confirm-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>我已核对发票号码、日期和金额，确认无误</span>
                </label>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          </div>
          <footer className="editor-footer">
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() =>
                setConfirmAction(kind === "draft" ? "discard" : "archive")
              }
            >
              {kind === "draft" ? <X size={15} /> : <Archive size={15} />}
              {kind === "draft"
                ? "移出待核对"
                : selection.kind === "invoice" && selection.value.archived
                  ? "恢复有效记录"
                  : "归档此记录"}
            </button>
            <div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={requestClose}
              >
                暂不处理
              </button>
              <button
                className="button primary"
                disabled={
                  busy || !!duplicate || (kind === "draft" && !confirmed)
                }
                onClick={save}
              >
                {busy ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Check size={17} />
                )}
                {duplicate
                  ? "已记录，无需重复保存"
                  : kind === "draft"
                    ? "确认并保存"
                    : "保存修改"}
              </button>
            </div>
          </footer>
          <ConfirmDialog
            open={!!confirmAction}
            busy={busy}
            danger={
              !(
                confirmAction === "archive" &&
                selection.kind === "invoice" &&
                selection.value.archived
              )
            }
            title={
              confirmAction === "close"
                ? "放弃未保存的修改？"
                : confirmAction === "discard"
                  ? "移出待核对列表？"
                  : selection.kind === "invoice" && selection.value.archived
                    ? "恢复为有效记录？"
                    : "将这条发票记录归档？"
            }
            description={
              confirmAction === "close"
                ? "你在当前核对窗口所作的修改尚未保存。"
                : confirmAction === "discard"
                  ? "不会删除已有正式记录。需要时可重新导入原件。"
                  : selection.kind === "invoice" && selection.value.archived
                    ? "恢复后，这张发票会重新计入统计，无需再次导入。"
                    : "归档后，这张发票不再计入统计；再次导入仍会提示重复。你可以随时恢复这条记录。"
            }
            confirmLabel={
              confirmAction === "close"
                ? "放弃修改"
                : confirmAction === "discard"
                  ? "确认移出"
                  : selection.kind === "invoice" && selection.value.archived
                    ? "恢复记录"
                    : "确认归档"
            }
            onCancel={() => setConfirmAction(undefined)}
            onConfirm={executeAction}
          />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  );
}
