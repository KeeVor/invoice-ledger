import logo from "./assets/piaoji.svg";

// Native overlay buttons retain Windows snapping, keyboard access and safe close.
export function WindowChrome() {
  return (
    <div className="window-chrome" aria-hidden="true">
      <div className="window-drag-region">
        <img src={logo} alt="" draggable={false} />
        <span>票迹</span>
      </div>
    </div>
  );
}
