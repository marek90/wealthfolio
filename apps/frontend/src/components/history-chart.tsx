import { useHapticFeedback } from "@/hooks";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import { useIsMobileViewport } from "@/hooks/use-platform";
import { formatDate } from "@/lib/utils";
import { AmountDisplay, useDateFormatting } from "@wealthfolio/ui";
import { ChartConfig, ChartContainer } from "@wealthfolio/ui/components/ui/chart";
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Area, AreaChart, Brush, ReferenceArea, ReferenceDot, Tooltip, XAxis, YAxis } from "recharts";
import type { MouseHandlerDataParam } from "recharts/types/synchronisation/types";
import {
  HistoryChartActiveDot,
  HistoryChartMarkerShape,
  type RechartsActiveDotProps,
  type RechartsMarkerShapeProps,
} from "./history-chart-marker";
import { getAutomaticHistoryChartScale, type HistoryChartScaleMode } from "./history-chart-scale";

const CHART_SCRUB_HAPTIC_INTERVAL_MS = 80;

export interface HistoryChartData {
  date: string;
  totalValue: number;
  netContribution: number;
  currency: string;
}

interface HistoryChartProps {
  data: HistoryChartData[];
  isLoading?: boolean;
  /** Dates with manual snapshots (YYYY-MM-DD format) */
  snapshotDates?: string[];
  /** Toggle visibility of snapshot markers */
  showMarkers?: boolean;
  /** Callback when a marker is clicked */
  onMarkerClick?: (date: string) => void;
  /** Controls how the Y-axis domain is calculated. */
  scaleMode?: HistoryChartScaleMode;
  /** Expands the domain to show net contribution when the widened span stays under this ratio. */
  netContributionMaxDomainSpanRatio?: number;
  /** Keeps narrow ranges from zooming too aggressively. Ratio is relative to the visible center. */
  minDomainSpanRatio?: number;
  /** Called when the brush selection changes. Receives the visible date window (YYYY-MM-DD strings),
   *  or undefined when the brush spans the full dataset. Client-side only — no refetch. */
  onVisibleRangeChange?: (range: { from: string; to: string } | undefined) => void;
}

interface TooltipEntry {
  dataKey?: string | number;
  payload?: HistoryChartData;
}

interface TooltipBaseProps {
  active?: boolean;
  payload?: TooltipEntry[];
}

interface CustomTooltipProps extends TooltipBaseProps {
  isBalanceHidden: boolean;
  isChartHovered: boolean;
}

const CustomTooltip = ({
  active,
  payload,
  isBalanceHidden,
  isChartHovered,
}: CustomTooltipProps) => {
  const dateFormatting = useDateFormatting();

  const { t } = useTranslation();
  if (!active || !payload?.length) {
    return null;
  }

  const totalValueData = payload.find(
    (item): item is TooltipEntry & { dataKey: "totalValue"; payload: HistoryChartData } =>
      item?.dataKey === "totalValue" && item.payload !== undefined,
  );
  const netContributionData = payload.find(
    (item): item is TooltipEntry & { dataKey: "netContribution"; payload: HistoryChartData } =>
      item?.dataKey === "netContribution" && item.payload !== undefined,
  );

  const tvPayload = totalValueData?.payload;
  const ncPayload = netContributionData?.payload;

  if (!tvPayload) {
    return null;
  }

  const netContributionPayload = ncPayload ?? tvPayload;
  const tooltipColor = tvPayload.totalValue >= 0 ? "var(--success)" : "var(--destructive)";

  return (
    <div className="bg-popover pointer-events-none grid grid-cols-1 gap-1.5 rounded-md border p-2 shadow-md">
      <p className="text-muted-foreground text-xs">{formatDate(tvPayload.date, dateFormatting)}</p>

      <div className="flex items-center justify-between space-x-2">
        <div className="flex items-center space-x-1.5">
          <span className="block h-0.5 w-3" style={{ backgroundColor: tooltipColor }} />
          <span className="text-muted-foreground text-xs">
            {t("common:component.total_value_label")}
          </span>
        </div>
        <AmountDisplay
          value={tvPayload.totalValue}
          currency={tvPayload.currency}
          isHidden={isBalanceHidden}
          className="text-xs font-semibold"
        />
      </div>
      {isChartHovered && netContributionPayload && (
        <div className="flex items-center justify-between space-x-2">
          <div className="flex items-center space-x-1.5">
            <span
              className="block h-0 w-3 border-b-2 border-dashed"
              style={{ borderColor: "var(--muted-foreground)" }}
            />
            <span className="text-muted-foreground text-xs">
              {t("common:component.net_deposit_label")}
            </span>
          </div>
          <AmountDisplay
            value={netContributionPayload.netContribution}
            currency={netContributionPayload.currency}
            isHidden={isBalanceHidden}
            className="text-xs font-semibold"
          />
        </div>
      )}
    </div>
  );
};

export function HistoryChart({
  data,
  isLoading,
  snapshotDates,
  showMarkers,
  onMarkerClick,
  scaleMode,
  netContributionMaxDomainSpanRatio,
  minDomainSpanRatio,
  onVisibleRangeChange,
}: HistoryChartProps) {
  const { t } = useTranslation();
  const dateFormatting = useDateFormatting();
  const { triggerHaptic } = useHapticFeedback();
  const { isBalanceHidden } = useBalancePrivacy();
  const [isChartHovered, setIsChartHovered] = useState(false);
  const [hoveredMarker, setHoveredMarker] = useState(false);
  const isMobile = useIsMobileViewport();
  const isTouchScrubbingRef = useRef(false);
  const lastHapticLabelRef = useRef<string | number | undefined>(undefined);
  const lastHapticAtRef = useRef(0);
  const id = useId();
  const fillGradientId = `historyFill-${id}`;
  const strokeGradientId = `historyStroke-${id}`;

  const [brushIndices, setBrushIndices] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setBrushIndices(null);
  }
  const startIndex = brushIndices?.startIndex ?? 0;
  const endIndex = brushIndices?.endIndex ?? Math.max(0, data.length - 1);
  const visibleData = useMemo(
    () => (brushIndices ? data.slice(startIndex, endIndex + 1) : data),
    [data, brushIndices, startIndex, endIndex],
  );

  // Drag-to-select state (FB1). Tracked by date label (activeLabel) rather than index, so it
  // stays correct even when the chart is already brush-zoomed (indices become view-relative).
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragRangeRef = useRef<{ start: string; end: string } | null>(null);
  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null);

  // --- Brush geometry, touch handling, and custom edge labels ---
  // Wrapper element used both to measure chart width (for label placement) and to map
  // touch clientX -> data index for our own traveller drag handling. A callback ref (not
  // useEffect) so measurement re-attaches when the chart node mounts — the component can
  // render null while data is still loading, after which a []-deps effect would never re-run.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const setContainerNode = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!node) return;
    const measure = () => setContainerWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(measure);
      resizeObserverRef.current.observe(node);
    }
  }, []);

  // Keep the latest brush indices readable from imperative touch handlers without stale closures.
  const brushIndicesRef = useRef(brushIndices);
  brushIndicesRef.current = brushIndices;

  // iOS synthesizes mouse events after touch; timestamp touches so the mouse-only
  // drag-to-select can ignore those phantom events (a source of the mobile crash).
  const lastTouchAtRef = useRef(0);

  // Brush layout constants — single source of truth for the <AreaChart margin>, the
  // <Brush> dimensions, and our custom edge-label placement below.
  const BRUSH_MARGIN = 8;
  const BRUSH_TRAVELLER_WIDTH = 10;
  const BRUSH_HEIGHT = 20;
  const BRUSH_MARGIN_BOTTOM = 28;

  // Vertical center of the brush band, measured from the container's bottom edge (so it is
  // page-height independent). Defaults to the computed position; corrected by measurement.
  const [brushCenterFromBottom, setBrushCenterFromBottom] = useState(
    BRUSH_MARGIN_BOTTOM + BRUSH_HEIGHT / 2,
  );
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const slide = node.querySelector<SVGRectElement>(".recharts-brush-slide");
    if (!slide) return;
    const nodeRect = node.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    const center = nodeRect.bottom - (slideRect.top + slideRect.height / 2);
    setBrushCenterFromBottom((prev) => (Math.abs(prev - center) > 0.5 ? center : prev));
  }, [containerWidth, data.length]);
  const lastIndex = Math.max(1, data.length - 1);
  const brushUsableWidth = Math.max(0, containerWidth - BRUSH_MARGIN * 2 - BRUSH_TRAVELLER_WIDTH);

  // Which traveller the current touch is dragging.
  const activeTravellerRef = useRef<"start" | "end" | null>(null);

  const indexFromClientX = (clientX: number): number | null => {
    const el = containerRef.current;
    if (!el || data.length === 0 || brushUsableWidth <= 0) return null;
    const rect = el.getBoundingClientRect();
    const frac = (clientX - rect.left - BRUSH_MARGIN) / brushUsableWidth;
    const idx = Math.round(frac * (data.length - 1));
    return Math.max(0, Math.min(data.length - 1, idx));
  };

  const moveActiveTravellerTo = (idx: number) => {
    const cur = brushIndicesRef.current;
    const s = cur?.startIndex ?? 0;
    const e = cur?.endIndex ?? data.length - 1;
    let ns = s;
    let ne = e;
    if (activeTravellerRef.current === "start") ns = Math.min(idx, e);
    else ne = Math.max(idx, s);
    if (ns === s && ne === e) return; // idempotent — avoids redundant re-renders
    setBrushIndices({ startIndex: ns, endIndex: ne });
    onVisibleRangeChange?.({ from: data[ns].date, to: data[ne].date });
  };

  const handleTravellerTouchMove = (e: TouchEvent) => {
    if (!activeTravellerRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    lastTouchAtRef.current = Date.now();
    e.preventDefault(); // stop page scroll and the browser's horizontal back/forward swipe
    const idx = indexFromClientX(touch.clientX);
    if (idx != null) moveActiveTravellerTo(idx);
  };

  const endTravellerTouch = () => {
    activeTravellerRef.current = null;
    lastTouchAtRef.current = Date.now();
    window.removeEventListener("touchmove", handleTravellerTouchMove);
    window.removeEventListener("touchend", endTravellerTouch);
    window.removeEventListener("touchcancel", endTravellerTouch);
  };

  const handleTravellerTouchStart = (e: React.TouchEvent<SVGRectElement>) => {
    const touch = e.touches[0];
    if (!touch) return;
    // Take over from Recharts' own (mouse-only, touch-broken) traveller handling.
    e.stopPropagation();
    lastTouchAtRef.current = Date.now();
    const idx = indexFromClientX(touch.clientX);
    if (idx == null) return;
    const cur = brushIndicesRef.current;
    const s = cur?.startIndex ?? 0;
    const en = cur?.endIndex ?? data.length - 1;
    activeTravellerRef.current = Math.abs(idx - s) <= Math.abs(idx - en) ? "start" : "end";
    window.addEventListener("touchmove", handleTravellerTouchMove, { passive: false });
    window.addEventListener("touchend", endTravellerTouch);
    window.addEventListener("touchcancel", endTravellerTouch);
  };

  const scaleConfig = useMemo(
    () =>
      getAutomaticHistoryChartScale(visibleData, {
        ...(scaleMode ? { mode: scaleMode } : {}),
        ...(netContributionMaxDomainSpanRatio === undefined
          ? {}
          : { netContributionMaxDomainSpanRatio }),
        ...(minDomainSpanRatio === undefined ? {} : { minDomainSpanRatio }),
      }),
    [visibleData, scaleMode, netContributionMaxDomainSpanRatio, minDomainSpanRatio],
  );

  const chartConfig = {
    totalValue: {
      label: t("common:component.total_value"),
    },
    netContribution: {
      label: t("common:component.net_contribution"),
    },
  } satisfies ChartConfig;

  // Compute where y=0 falls in the gradient (0=top, 1=bottom)
  // to split green (positive) / red (negative) fill & stroke
  const { zeroOffset, allPositive, allNegative } = useMemo(() => {
    if (visibleData.length === 0) return { zeroOffset: 0, allPositive: true, allNegative: false };
    let min = Infinity;
    let max = -Infinity;
    for (const d of visibleData) {
      if (d.totalValue < min) min = d.totalValue;
      if (d.totalValue > max) max = d.totalValue;
    }
    if (min >= 0) return { zeroOffset: 1, allPositive: true, allNegative: false };
    if (max <= 0) return { zeroOffset: 0, allPositive: false, allNegative: true };
    const [domainMin, domainMax] = scaleConfig.domain;
    const offset = domainMax / (domainMax - domainMin);
    return { zeroOffset: offset, allPositive: false, allNegative: false };
  }, [visibleData, scaleConfig.domain]);

  // Build a map of date -> index for efficient lookup
  const dateToIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((item, index) => {
      map.set(item.date, index);
    });
    return map;
  }, [data]);

  // Get marker data points (snapshot dates that exist in the chart data)
  const markerDataPoints = useMemo(() => {
    if (!showMarkers || !snapshotDates || snapshotDates.length === 0) {
      return [];
    }
    return snapshotDates
      .map((date) => {
        const index = dateToIndexMap.get(date);
        if (index !== undefined && data[index]) {
          return {
            date,
            index,
            value: data[index].totalValue,
          };
        }
        return null;
      })
      .filter((item): item is { date: string; index: number; value: number } => item !== null);
  }, [showMarkers, snapshotDates, dateToIndexMap, data]);

  // Set for efficient marker date lookup (used by chart onClick)
  const markerDateSet = useMemo(
    () => new Set(markerDataPoints.map((p) => p.date)),
    [markerDataPoints],
  );
  const singleDataPoint =
    data.length === 1 && !markerDateSet.has(data[0].date) ? data[0] : undefined;

  if (isLoading && data.length === 0) {
    return null;
  }

  // Gradient stops for fill and stroke based on zero crossing
  const zeroPercent = `${(zeroOffset * 100).toFixed(1)}%`;

  const maybeTriggerScrubHaptic = (chartState: MouseHandlerDataParam) => {
    if (!isMobile || !isTouchScrubbingRef.current || !chartState.isTooltipActive) {
      return;
    }

    const activeLabel = chartState.activeLabel;
    if (activeLabel == null || activeLabel === lastHapticLabelRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastHapticAtRef.current < CHART_SCRUB_HAPTIC_INTERVAL_MS) {
      return;
    }

    lastHapticLabelRef.current = activeLabel;
    lastHapticAtRef.current = now;
    triggerHaptic();
  };

  const resetTouchScrubState = () => {
    isTouchScrubbingRef.current = false;
    lastHapticLabelRef.current = undefined;
  };

  const handleChartMove = (chartState: MouseHandlerDataParam) => {
    if (!showMarkers || chartState.activeLabel == null) {
      setHoveredMarker(false);
    } else {
      setHoveredMarker(markerDateSet.has(String(chartState.activeLabel)));
    }

    if (isDraggingRef.current && chartState.activeLabel != null) {
      const newEnd = String(chartState.activeLabel);
      dragRangeRef.current = dragRangeRef.current ? { ...dragRangeRef.current, end: newEnd } : null;
      setDragRange((prev) => (prev ? { ...prev, end: newEnd } : null));
    }

    maybeTriggerScrubHaptic(chartState);
  };

  return (
    <div ref={setContainerNode} data-testid="history-chart-root" className="relative h-full w-full">
      <ChartContainer
        config={chartConfig}
        className="history-brush h-full w-full"
        data-no-swipe-drag
      >
      <AreaChart
        data={data}
        stackOffset="sign"
        style={{
          cursor: dragRange
            ? "col-resize"
            : showMarkers && isChartHovered && hoveredMarker
              ? "pointer"
              : undefined,
        }}
        margin={{
          top: 0,
          right: BRUSH_MARGIN,
          left: BRUSH_MARGIN,
          bottom: BRUSH_MARGIN_BOTTOM,
        }}
        onDoubleClick={() => {
          if (brushIndices) {
            setBrushIndices(null);
            onVisibleRangeChange?.(undefined);
          }
        }}
        onMouseEnter={() => setIsChartHovered(true)}
        onMouseLeave={() => {
          setIsChartHovered(false);
          setHoveredMarker(false);
          resetTouchScrubState();
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            dragRangeRef.current = null;
            setDragRange(null);
          }
        }}
        onMouseMove={handleChartMove}
        onMouseDown={(chartState) => {
          // Ignore mouse events synthesized right after a touch — otherwise a phantom
          // drag-to-select fires on mobile (the chart-body zoom is a mouse-only affordance).
          if (Date.now() - lastTouchAtRef.current < 700) return;
          const label = (chartState as unknown as MouseHandlerDataParam).activeLabel;
          if (label == null) return;
          const s = String(label);
          isDraggingRef.current = true;
          dragRangeRef.current = { start: s, end: s };
          setDragRange({ start: s, end: s });
        }}
        onMouseUp={() => {
          if (!isDraggingRef.current) return;
          isDraggingRef.current = false;
          const drag = dragRangeRef.current;
          dragRangeRef.current = null;
          setDragRange(null);
          if (drag && drag.start !== drag.end) {
            const a = dateToIndexMap.get(drag.start);
            const b = dateToIndexMap.get(drag.end);
            if (a == null || b == null) return;
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            setBrushIndices({ startIndex: lo, endIndex: hi });
            didDragRef.current = true;
            onVisibleRangeChange?.({ from: data[lo].date, to: data[hi].date });
          }
        }}
        onClick={(chartState) => {
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          if (!showMarkers || chartState?.activeLabel == null) return;
          const clickedDate = String(chartState.activeLabel);
          if (markerDateSet.has(clickedDate)) {
            onMarkerClick?.(clickedDate);
          }
        }}
        onTouchStart={(chartState) => {
          lastTouchAtRef.current = Date.now();
          isTouchScrubbingRef.current = true;
          setIsChartHovered(true);
          handleChartMove(chartState);
        }}
        onTouchMove={(chartState) => {
          lastTouchAtRef.current = Date.now();
          handleChartMove(chartState);
        }}
        onTouchEnd={() => {
          lastTouchAtRef.current = Date.now();
          setIsChartHovered(false);
          setHoveredMarker(false);
          resetTouchScrubState();
        }}
      >
        <defs>
          <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
            {allNegative ? (
              <>
                <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.2} />
                <stop offset="70%" stopColor="var(--destructive)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
              </>
            ) : allPositive ? (
              <>
                <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2} />
                <stop offset="70%" stopColor="var(--success)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.2} />
                <stop offset={zeroPercent} stopColor="var(--success)" stopOpacity={0.05} />
                <stop offset={zeroPercent} stopColor="var(--destructive)" stopOpacity={0.05} />
                <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0.2} />
              </>
            )}
          </linearGradient>
          <linearGradient id={strokeGradientId} x1="0" y1="0" x2="0" y2="1">
            {allNegative ? (
              <stop offset="0%" stopColor="var(--destructive)" />
            ) : allPositive ? (
              <stop offset="0%" stopColor="var(--success)" />
            ) : (
              <>
                <stop offset={zeroPercent} stopColor="var(--success)" />
                <stop offset={zeroPercent} stopColor="var(--destructive)" />
              </>
            )}
          </linearGradient>
        </defs>
        <Tooltip
          position={isMobile ? { y: 60 } : { y: -20 }}
          cursor={{ stroke: "var(--border)", strokeWidth: 1, pointerEvents: "none" }}
          wrapperStyle={{ pointerEvents: "none" }}
          content={(props) => (
            <CustomTooltip
              {...(props as unknown as TooltipBaseProps)}
              isBalanceHidden={isBalanceHidden}
              isChartHovered={isChartHovered}
            />
          )}
        />
        <XAxis hide dataKey="date" type="category" />
        <YAxis
          hide
          type="number"
          scale={scaleConfig.scale === "log" ? "log" : "auto"}
          domain={scaleConfig.domain}
        />
        <Area
          isAnimationActive={true}
          animationDuration={300}
          animationEasing="ease-out"
          connectNulls={true}
          type="monotone"
          dataKey="totalValue"
          stroke={`url(#${strokeGradientId})`}
          activeDot={(props: RechartsActiveDotProps & { payload?: HistoryChartData }) =>
            showMarkers && props.payload?.date && markerDateSet.has(props.payload.date) ? null : (
              <HistoryChartActiveDot {...props} stroke="var(--success)" />
            )
          }
          fillOpacity={1}
          fill={`url(#${fillGradientId})`}
          style={{ pointerEvents: "none" }}
        />
        {scaleConfig.showNetContribution && (
          <Area
            isAnimationActive={true}
            animationDuration={300}
            animationEasing="ease-out"
            connectNulls={true}
            type="monotone"
            dataKey="netContribution"
            stroke="var(--muted-foreground)"
            activeDot={false}
            fill="transparent"
            strokeDasharray="5 5"
            strokeOpacity={isChartHovered ? 0.8 : 0}
            style={{ pointerEvents: "none" }}
          />
        )}
        {showMarkers &&
          markerDataPoints.map((point) => (
            <ReferenceDot
              key={`marker-${point.date}`}
              x={point.date}
              y={point.value}
              shape={(props: RechartsMarkerShapeProps) => (
                <HistoryChartMarkerShape {...props} variant="snapshot" value={point.value} />
              )}
            />
          ))}
        {singleDataPoint && (
          <ReferenceDot
            x={singleDataPoint.date}
            y={singleDataPoint.totalValue}
            r={4}
            fill={singleDataPoint.totalValue >= 0 ? "var(--success)" : "var(--destructive)"}
            stroke="var(--background)"
            strokeWidth={2}
          />
        )}
        {dragRange &&
          data.length > 0 &&
          (() => {
            // Order the two drag labels by their position in the full series so x1 <= x2.
            const a = dateToIndexMap.get(dragRange.start);
            const b = dateToIndexMap.get(dragRange.end);
            if (a == null || b == null) return null;
            return (
              <ReferenceArea
                x1={data[Math.min(a, b)].date}
                x2={data[Math.max(a, b)].date}
                fill="var(--primary)"
                fillOpacity={0.1}
                stroke="var(--primary)"
                strokeOpacity={0.4}
              />
            );
          })()}
        {data.length > 1 && (
          <Brush
            dataKey="date"
            height={BRUSH_HEIGHT}
            travellerWidth={BRUSH_TRAVELLER_WIDTH}
            gap={1}
            stroke="#667F0A"
            tickFormatter={(value) => formatDate(value as string, dateFormatting)}
            fill="transparent"
            traveller={(props) => {
              // Rounded "pill" handles in place of the default square ones, to match the
              // app's soft fully-rounded UI. Inset vertically for a lighter look. A larger
              // transparent hit rect makes the handle easy to grab on touch, and carries our
              // own touch-drag handling (Recharts moves travellers via mouse events only).
              const { x, y, width, height } = props;
              const HIT_WIDTH = 32;
              return (
                <g>
                  <rect
                    x={x + width / 2 - HIT_WIDTH / 2}
                    y={y - 6}
                    width={HIT_WIDTH}
                    height={height + 12}
                    fill="transparent"
                    style={{ touchAction: "none", cursor: "col-resize" }}
                    onTouchStart={handleTravellerTouchStart}
                  />
                  <rect
                    x={x}
                    y={y + 1}
                    width={width}
                    height={Math.max(0, height - 2)}
                    rx={width / 2}
                    ry={width / 2}
                    fill="#667F0A"
                    pointerEvents="none"
                  />
                </g>
              );
            }}
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={(range) => {
              if (range?.startIndex == null || range?.endIndex == null) return;
              const si = range.startIndex;
              const ei = range.endIndex;
              const cur = brushIndicesRef.current;
              // Idempotent: skip redundant updates that would otherwise re-render in a loop.
              if (cur && cur.startIndex === si && cur.endIndex === ei) return;
              setBrushIndices({ startIndex: si, endIndex: ei });
              onVisibleRangeChange?.({ from: data[si].date, to: data[ei].date });
            }}
          />
        )}
      </AreaChart>
      </ChartContainer>
      {data.length > 1 &&
        containerWidth > 0 &&
        (() => {
          // Custom brush edge date labels (Recharts' own are hidden via globals.css).
          // Default to the outer side of each traveller; flip to the inner side when the
          // outer label would clip off-screen at the extremes. Olive to match the brush.
          const startTravellerX = BRUSH_MARGIN + (startIndex / lastIndex) * brushUsableWidth;
          const endTravellerRightX =
            BRUSH_MARGIN + (endIndex / lastIndex) * brushUsableWidth + BRUSH_TRAVELLER_WIDTH;
          const GAP = 5;
          const EST_LABEL_WIDTH = 78; // approx width of a formatted date at this size
          const startOuterFits = startTravellerX - GAP - EST_LABEL_WIDTH >= 0;
          const endOuterFits = endTravellerRightX + GAP + EST_LABEL_WIDTH <= containerWidth;
          const LABEL_COLOR = "#667F0A"; // olive, matching the brush regardless of side
          // Vertically center each label on the brush band (translateY(50%) offsets the box
          // so its middle — not its bottom edge — sits on the measured center line).
          const vCenter = {
            bottom: brushCenterFromBottom,
            transform: "translateY(50%)",
            color: LABEL_COLOR,
          } as const;
          return (
            <div className="pointer-events-none absolute inset-0 select-none">
              <span
                className="absolute whitespace-nowrap text-[10px] font-medium"
                style={
                  startOuterFits
                    ? { ...vCenter, right: containerWidth - startTravellerX + GAP }
                    : { ...vCenter, left: startTravellerX + BRUSH_TRAVELLER_WIDTH + GAP }
                }
              >
                {formatDate(data[startIndex].date, dateFormatting)}
              </span>
              <span
                className="absolute whitespace-nowrap text-[10px] font-medium"
                style={
                  endOuterFits
                    ? { ...vCenter, left: endTravellerRightX + GAP }
                    : {
                        ...vCenter,
                        right: containerWidth - (endTravellerRightX - BRUSH_TRAVELLER_WIDTH) + GAP,
                      }
                }
              >
                {formatDate(data[endIndex].date, dateFormatting)}
              </span>
            </div>
          );
        })()}
    </div>
  );
}
