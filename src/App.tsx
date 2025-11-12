import { useCallback, useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import { toPng } from "html-to-image";

type PointerKind = "mouse" | "pen" | "touch" | "unknown";

const BALL_DIAMETER_MM = 57.2;
const TIP_DIAMETER_MM = 12.4;
const HALF_TIP_MM = TIP_DIAMETER_MM / 2;
const BALL_RADIUS_MM = BALL_DIAMETER_MM / 2;
const CANVAS_SIZE_PX = 360;
const MIN_CANVAS_PX = 240;
const MAX_CANVAS_PX = 420;

type TipPosition = {
  x: number; // east-west in mm (east is positive)
  y: number; // north-south in mm (north is positive)
};

const formatValue = (valueTips: number) => {
  const rounded = Math.round(valueTips * 2) / 2;
  if (Math.abs(rounded) < 0.001) {
    return "";
  }
  return `${
    Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toString()
  }`;
};

const describePosition = (pos: TipPosition) => {
  const yTips = pos.y / TIP_DIAMETER_MM;
  const xTips = pos.x / TIP_DIAMETER_MM;
  const parts: string[] = [];

  const yValue = formatValue(Math.abs(yTips));
  if (yValue) {
    parts.push(`${pos.y > 0 ? "N" : "S"}${yValue}`);
  }

  const xValue = formatValue(Math.abs(xTips));
  if (xValue) {
    parts.push(`${pos.x > 0 ? "E" : "W"}${xValue}`);
  }

  return parts.length ? parts.join(" ") : "C";
};

const useGridPoints = () => {
  return useMemo(() => {
    const points: TipPosition[] = [];
    const steps = Math.ceil(BALL_RADIUS_MM / HALF_TIP_MM);
    for (let i = -steps; i <= steps; i += 1) {
      for (let j = -steps; j <= steps; j += 1) {
        const x = i * HALF_TIP_MM;
        const y = j * HALF_TIP_MM;
        if (x * x + y * y <= BALL_RADIUS_MM * BALL_RADIUS_MM + 1e-3) {
          points.push({ x, y });
        }
      }
    }
    return points;
  }, []);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
};

const fallbackCopy = (text: string) => {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    success = false;
  }
  document.body.removeChild(textarea);
  return success;
};

type VibrateNavigator = Navigator & {
  webkitVibrate?: (pattern: number | number[]) => boolean;
};

function App() {
  const exportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gridPoints = useGridPoints();
  const [tipPosition, setTipPosition] = useState<TipPosition>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const touchActiveRef = useRef(false);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [canvasSizePx, setCanvasSizePx] = useState(CANVAS_SIZE_PX);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const label = describePosition(tipPosition);

  const copyToClipboard = useCallback(async (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // swallow and fallback
      }
    }
    return fallbackCopy(text);
  }, []);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(label);
    if (!success) return;
    setCopied(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
  }, [copyToClipboard, label]);

  useLayoutEffect(() => {
    const wrapper = canvasWrapperRef.current;
    if (!wrapper || typeof ResizeObserver === "undefined") {
      return;
    }
    const clampSize = (width: number) => {
      if (!width) return;
      const next = Math.min(Math.max(width, MIN_CANVAS_PX), MAX_CANVAS_PX);
      setCanvasSizePx(next);
    };
    clampSize(wrapper.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      clampSize(entry.contentRect.width);
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  const mmToPx = canvasSizePx / BALL_DIAMETER_MM;
  const ballRadiusPx = BALL_RADIUS_MM * mmToPx;
  const tipRadiusPx = (TIP_DIAMETER_MM / 2) * mmToPx;

  const findNearestGridPoint = useCallback(
    (target: TipPosition) => {
      let best = gridPoints[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const point of gridPoints) {
        const dx = point.x - target.x;
        const dy = point.y - target.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = point;
        }
      }
      return best;
    },
    [gridPoints]
  );

  const vibrate = useCallback((duration = 12) => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as VibrateNavigator;
    const vib = (nav.vibrate ?? nav.webkitVibrate) as
      | ((pattern: number | Iterable<number>) => boolean)
      | undefined;
    if (typeof vib === "function") {
      vib.call(nav, duration);
    }
  }, []);

  const updatePositionFromClientPoint = useCallback(
    (clientX: number, clientY: number, pointerType: PointerKind) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      const offsetXmm = (relativeX - rect.width / 2) / mmToPx;
      const offsetYmm = (rect.height / 2 - relativeY) / mmToPx;
      const snapped = findNearestGridPoint({ x: offsetXmm, y: offsetYmm });
      setTipPosition((prev) => {
        if (prev.x === snapped.x && prev.y === snapped.y) {
          return prev;
        }
        if (pointerType === "touch") {
          vibrate();
        }
        return snapped;
      });
    },
    [findNearestGridPoint, mmToPx, vibrate]
  );

  const updatePositionFromPointerEvent = useCallback(
    (event: React.PointerEvent) => {
      const pointerType = (event.pointerType ?? "unknown") as PointerKind;
      updatePositionFromClientPoint(event.clientX, event.clientY, pointerType);
    },
    [updatePositionFromClientPoint]
  );

  const updatePositionFromTouchEvent = useCallback(
    (event: React.TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return;
      updatePositionFromClientPoint(touch.clientX, touch.clientY, "touch");
    },
    [updatePositionFromClientPoint]
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    draggingRef.current = true;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePositionFromPointerEvent(event);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!draggingRef.current) return;
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    updatePositionFromPointerEvent(event);
  };

  const endDrag = (event: React.PointerEvent) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleTouchStart = (event: React.TouchEvent) => {
    touchActiveRef.current = true;
    draggingRef.current = true;
    event.preventDefault();
    updatePositionFromTouchEvent(event);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!touchActiveRef.current) return;
    event.preventDefault();
    updatePositionFromTouchEvent(event);
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    touchActiveRef.current = false;
    draggingRef.current = false;
    event.preventDefault();
    updatePositionFromTouchEvent(event);
  };

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, "cue-ball.svg");
  };

  const downloadPng = async () => {
    if (!exportRef.current) return;
    try {
      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
      });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      downloadBlob(blob, "cue-ball.png");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Unable to export PNG", error);
    }
  };

  const gridLevels = useMemo(() => {
    const levels: number[] = [];
    const steps = Math.floor(BALL_RADIUS_MM / HALF_TIP_MM);
    for (let i = -steps; i <= steps; i += 1) {
      levels.push(i * HALF_TIP_MM);
    }
    return levels;
  }, []);

  return (
    <div className="min-h-screen bg-felt p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 rounded-2xl bg-white/90 p-4 shadow-xl ring-1 ring-black/5 sm:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-900">
            Where on the Cue Ball?
          </h1>
          <p className="text-sm text-slate-600">
            Drag the tip marker around the cue ball. Positions snap in half-tip
            increments (6.2&nbsp;mm) relative to the ball center.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[400px,1fr]">
          <div
            ref={exportRef}
            className="flex select-none items-center justify-center rounded-2xl bg-felt/70 p-4 shadow-inner"
          >
            <div ref={canvasWrapperRef} className="w-full max-w-[420px]">
              <svg
                ref={svgRef}
                width={canvasSizePx}
                height={canvasSizePx}
                viewBox={`0 0 ${canvasSizePx} ${canvasSizePx}`}
                className="h-auto w-full select-none touch-none"
                style={{
                  WebkitUserSelect: "none",
                  userSelect: "none",
                  WebkitTouchCallout: "none",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                onPointerCancel={endDrag}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                aria-labelledby="cueballTitle"
                role="img"
              >
                <title id="cueballTitle">Cue ball contact visualization</title>
                <defs>
                  <radialGradient id="ballShade" cx="30%" cy="30%" r="70%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="65%" stopColor="#f3f3f3" />
                    <stop offset="100%" stopColor="#dcdcdc" />
                  </radialGradient>
                  <filter
                    id="shadow"
                    x="-20%"
                    y="-20%"
                    width="140%"
                    height="140%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="10"
                      stdDeviation="12"
                      floodColor="#000000"
                      floodOpacity="0.25"
                    />
                  </filter>
                </defs>
                <rect width="100%" height="100%" rx="24" fill="transparent" />
                <g
                  transform={`translate(${canvasSizePx / 2} ${
                    canvasSizePx / 2
                  })`}
                >
                  {gridLevels.map((level) => {
                    const offset = level * mmToPx;
                    return (
                      <g key={level}>
                        <line
                          x1={-ballRadiusPx}
                          x2={ballRadiusPx}
                          y1={-offset}
                          y2={-offset}
                          stroke="#d1d5db"
                          strokeWidth={level === 0 ? 1.5 : 0.6}
                          strokeDasharray={level === 0 ? "none" : "4 6"}
                        />
                        <line
                          x1={offset}
                          x2={offset}
                          y1={-ballRadiusPx}
                          y2={ballRadiusPx}
                          stroke="#d1d5db"
                          strokeWidth={level === 0 ? 1.5 : 0.6}
                          strokeDasharray={level === 0 ? "none" : "4 6"}
                        />
                      </g>
                    );
                  })}
                </g>
                <circle
                  cx={canvasSizePx / 2}
                  cy={canvasSizePx / 2}
                  r={ballRadiusPx}
                  fill="url(#ballShade)"
                  filter="url(#shadow)"
                />
                <g
                  transform={`translate(${canvasSizePx / 2} ${
                    canvasSizePx / 2
                  })`}
                >
                  {gridPoints.map((point, index) => {
                    const cx = point.x * mmToPx;
                    const cy = -point.y * mmToPx;
                    return (
                      <circle
                        key={`${point.x}-${point.y}-${index}`}
                        cx={cx}
                        cy={cy}
                        r={2.2}
                        fill={
                          point.x === 0 && point.y === 0 ? "#0f172a" : "#94a3b8"
                        }
                        opacity={point.x === 0 && point.y === 0 ? 0.8 : 0.6}
                      />
                    );
                  })}
                </g>
                <circle
                  cx={canvasSizePx / 2 + tipPosition.x * mmToPx}
                  cy={canvasSizePx / 2 - tipPosition.y * mmToPx}
                  r={tipRadiusPx}
                  fill="#111827"
                  stroke="white"
                  strokeWidth="2"
                />
              </svg>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Current tip code
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={label}
                  readOnly
                  className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-lg font-semibold text-slate-900 shadow-inner focus:outline-none"
                  aria-label="Current tip position code"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                  aria-label="Copy tip code"
                  title={copied ? "Copied!" : "Copy tip code"}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-5 w-5 ${copied ? "text-emerald-600" : ""}`}
                    aria-hidden="true"
                  >
                    <path d="M8 8.5V6.4c0-1.1.9-2 2-2h6.1c1.1 0 2 .9 2 2v6.1c0 1.1-.9 2-2 2H13.9" />
                    <rect x="6" y="8" width="8.5" height="10" rx="2" />
                  </svg>
                </button>
              </div>
              <p
                className="mt-1 text-xs font-medium text-emerald-600"
                role="status"
                aria-live="polite"
              >
                {copied ? "Copied" : "\u00a0"}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                <strong className="font-semibold text-slate-900">N/S</strong>{" "}
                values move vertically,{" "}
                <strong className="font-semibold text-slate-900">E/W</strong>{" "}
                values move horizontally. Each whole number equals one full tip
                (12.4&nbsp;mm); decimals represent half tips.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                onClick={downloadPng}
              >
                Download PNG
              </button>
              <button
                type="button"
                className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                onClick={downloadSvg}
              >
                Download SVG
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
