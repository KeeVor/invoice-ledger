import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import * as Select from "@radix-ui/react-select";
import * as Popover from "@radix-ui/react-popover";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";

export {
  Root as DialogRoot,
  Portal as DialogPortal,
  Overlay as DialogOverlay,
  Content as DialogContent,
  Title as DialogTitle,
} from "@radix-ui/react-dialog";
export { Provider as TooltipProvider } from "@radix-ui/react-tooltip";

export function Hint({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="glass-tooltip"
          sideOffset={8}
          collisionPadding={12}
        >
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function GlassSelect({
  label,
  value,
  options,
  onChange,
  icon,
  disabled,
  id,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Select.Root
      value={value || "__all__"}
      onValueChange={(next) => onChange(next === "__all__" ? "" : next)}
      disabled={disabled}
    >
      <Select.Trigger className="glass-select" aria-label={label} id={id}>
        {icon}
        <Select.Value />
        <Select.Icon className="select-chevron">
          <ChevronDown size={15} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="glass-menu"
          position="popper"
          sideOffset={8}
          collisionPadding={14}
        >
          <Select.ScrollUpButton className="menu-scroll">
            <ChevronUp size={15} />
          </Select.ScrollUpButton>
          <Select.Viewport className="menu-viewport">
            {options.map((option) => (
              <Select.Item
                className="menu-option"
                key={option.value}
                value={option.value || "__all__"}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={15} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="menu-scroll">
            <ChevronDown size={15} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

const yearOf = (value: string) =>
  /^\d{4}-/.test(value) ? Number(value.slice(0, 4)) : new Date().getFullYear();
const pad = (value: number) => String(value).padStart(2, "0");
const monthValue = (year: number, month: number) =>
  `${String(year).padStart(4, "0")}-${pad(month + 1)}`;
const localDate = (year: number, month: number, day: number) => {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(12, 0, 0, 0);
  return date;
};
const dayValue = (date: Date) =>
  `${monthValue(date.getFullYear(), date.getMonth())}-${pad(date.getDate())}`;

function YearControl({
  year,
  setYear,
}: {
  year: number;
  setYear: (year: number) => void;
}) {
  const [text, setText] = useState(String(year));
  useEffect(() => setText(String(year)), [year]);
  return (
    <div className="calendar-year">
      <button
        type="button"
        className="icon-button"
        aria-label="上一年"
        disabled={year <= 1}
        onClick={() => setYear(year - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      <label>
        <span className="sr-only">年份</span>
        <input
          aria-label="年份"
          inputMode="numeric"
          maxLength={4}
          value={text}
          onBlur={() => setText(String(year))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onChange={(event) => {
            const input = event.target.value;
            if (!/^\d{0,4}$/.test(input)) return;
            setText(input);
            const next = Number(input);
            if (Number.isInteger(next) && next >= 1 && next <= 9999)
              setYear(next);
          }}
        />
        <span>年</span>
      </label>
      <button
        type="button"
        className="icon-button"
        aria-label="下一年"
        disabled={year >= 9999}
        onClick={() => setYear(year + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function MonthPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(yearOf(value));
  const today = new Date();
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setYear(yearOf(value));
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="month-button" aria-label={label}>
          <CalendarDays size={16} />
          <span>
            {value
              ? `${value.slice(0, 4)} 年 ${Number(value.slice(5))} 月`
              : "全部月份"}
          </span>
          <ChevronDown size={14} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-popover month-popover"
          sideOffset={9}
          collisionPadding={16}
          aria-label={label}
        >
          <div className="popover-caption">按开票月份筛选</div>
          <YearControl year={year} setYear={setYear} />
          <div
            className="month-grid"
            role="group"
            aria-label={`${year} 年月份`}
          >
            {Array.from({ length: 12 }, (_, month) => (
              <button
                type="button"
                key={month}
                className={value === monthValue(year, month) ? "selected" : ""}
                aria-pressed={value === monthValue(year, month)}
                onClick={() => choose(monthValue(year, month))}
              >
                {month + 1} 月
              </button>
            ))}
          </div>
          <div className="calendar-footer">
            <button
              type="button"
              className="text-button"
              onClick={() => choose("")}
            >
              全部月份
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                choose(monthValue(today.getFullYear(), today.getMonth()))
              }
            >
              本月
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(yearOf(value));
  const [month, setMonth] = useState(Number(value.slice(5, 7)) - 1 || 0);
  const [focused, setFocused] = useState(value);
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  const firstDay = localDate(year, month, 1);
  const start = (firstDay.getDay() + 6) % 7;
  const days = localDate(year, month + 1, 0).getDate();
  const today = dayValue(new Date());
  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const moveMonth = (offset: number) => {
    const date = localDate(year, month + offset, 1);
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    setMonth(date.getMonth());
    setYear(date.getFullYear());
    setFocused(dayValue(date));
  };
  function moveFocus(date: Date) {
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return;
    setYear(date.getFullYear());
    setMonth(date.getMonth());
    setFocused(dayValue(date));
    requestAnimationFrame(() =>
      grid.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${dayValue(date)}"]`)
        ?.focus(),
    );
  }
  return (
    <div className="field date-field">
      <label htmlFor={id}>
        {label}
        <b>*</b>
      </label>
      <div className="date-input-wrap">
        <input
          id={id}
          name="invoice-date"
          autoComplete="off"
          spellCheck={false}
          placeholder="YYYY-MM-DD"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Popover.Root
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              const valid = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value);
              const date = valid
                ? localDate(
                    yearOf(value),
                    Number(value.slice(5, 7)) - 1,
                    Number(value.slice(8)),
                  )
                : new Date();
              setYear(date.getFullYear());
              setMonth(date.getMonth());
              setFocused(dayValue(date));
            }
          }}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              className="icon-button"
              aria-label="选择开票日期"
            >
              <CalendarDays size={17} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="glass-popover date-popover"
              sideOffset={9}
              collisionPadding={16}
              aria-label="选择开票日期"
            >
              <YearControl
                year={year}
                setYear={(next) => {
                  setYear(next);
                  setFocused(`${monthValue(next, month)}-01`);
                }}
              />
              <div className="calendar-month">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="上个月"
                  disabled={year === 1 && month === 0}
                  onClick={() => moveMonth(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>{month + 1} 月</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="下个月"
                  disabled={year === 9999 && month === 11}
                  onClick={() => moveMonth(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="calendar-week" aria-hidden="true">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div
                className="day-grid"
                ref={grid}
                role="group"
                aria-label={`${year} 年 ${month + 1} 月日期`}
              >
                {Array.from({ length: start }, (_, index) => (
                  <span key={`blank-${index}`} />
                ))}
                {Array.from({ length: days }, (_, index) => {
                  const day = index + 1;
                  const date = localDate(year, month, day);
                  const key = dayValue(date);
                  return (
                    <button
                      type="button"
                      key={key}
                      data-date={key}
                      aria-label={key}
                      aria-pressed={value === key}
                      aria-current={today === key ? "date" : undefined}
                      tabIndex={focused === key ? 0 : -1}
                      className={`${value === key ? "selected" : ""} ${today === key ? "today" : ""}`}
                      onClick={() => choose(key)}
                      onFocus={() => setFocused(key)}
                      onKeyDown={(event) => {
                        const offset = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        }[event.key];
                        if (offset) {
                          event.preventDefault();
                          moveFocus(localDate(year, month, day + offset));
                        }
                        if (event.key === "Home" || event.key === "End") {
                          event.preventDefault();
                          moveFocus(
                            localDate(
                              year,
                              month,
                              event.key === "Home" ? 1 : days,
                            ),
                          );
                        }
                        if (
                          event.key === "PageUp" ||
                          event.key === "PageDown"
                        ) {
                          event.preventDefault();
                          moveFocus(
                            localDate(
                              year,
                              month + (event.key === "PageUp" ? -1 : 1),
                              1,
                            ),
                          );
                        }
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-footer">
                <span>也可直接输入日期</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => choose(today)}
                >
                  今天
                </button>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  details,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger,
  busy,
  verificationText,
  verificationLabel = "请输入确认文字",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  verificationText?: string;
  verificationLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [verification, setVerification] = useState("");
  useEffect(() => {
    if (open) setVerification("");
  }, [open, verificationText]);
  const verified =
    !verificationText || verification.trim() === verificationText;
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="confirm-overlay" />
        <AlertDialog.Content
          className="confirm-dialog"
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected)
              returnFocus.current.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <div className={`confirm-symbol ${danger ? "warning" : ""}`}>
            {danger ? <AlertTriangle size={25} /> : <ShieldCheck size={25} />}
          </div>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          {details && <pre className="confirm-details">{details}</pre>}
          {verificationText && (
            <label className="confirm-verification">
              <span>{verificationLabel}</span>
              <input
                value={verification}
                onChange={(event) => setVerification(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                inputMode="numeric"
                aria-label={verificationLabel}
              />
            </label>
          )}
          <div className="confirm-actions">
            <AlertDialog.Cancel asChild>
              <button className="button secondary" disabled={busy}>
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <button
              className={`button ${danger ? "danger" : "primary"}`}
              disabled={busy || !verified}
              onClick={onConfirm}
            >
              {busy && <LoaderCircle size={16} className="spin" />}
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
