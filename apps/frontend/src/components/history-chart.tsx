import { useHapticFeedback } from "@/hooks";
import { ChartConfig, ChartContainer } from "@wealthfolio/ui/components/ui/chart";
import { useBalancePrivacy } from "@/hooks/use-balance-privacy";
import { useIsMobileViewport } from "@/hooks/use-platform";
import { formatDate } from "@/lib/utils";
import { AmountDisplay } from "@wealthfolio/ui";
import { useId, useMemo, useRef, useState } from "react";
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
      <p className="text-muted-foreground text-xs">{formatDate(tvPayload.date)}</p>

      <div className="flex items-center justify-between space-x-2">
        <div className="flex items-center space-x-1.5">
          <span className="block h-0.5 w-3" style={{ backgroundColor: tooltipColor }} />
          <span className="text-muted-foreground text-xs">Total Value:</span>
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
            <span className="text-muted-foreground text-xs">Net Deposit:</span>
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

  // Drag-to-select state (FB1). Three refs track in-progress drag without re-renders.
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [dragRange, setDragRange] = useState<{ start: number; end: number } | null>(null);

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
      label: "Total Value",
    },
    netContribution: {
      label: "Net Contribution",
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

    if (isDraggingRef.current && chartState.activeTooltipIndex != null) {
      const newEnd = Number(chartState.activeTooltipIndex);
      dragRangeRef.current = dragRangeRef.current ? { ...dragRangeRef.current, end: newEnd } : null;
      setDragRange((prev) => (prev ? { ...prev, end: newEnd } : null));
    }

    maybeTriggerScrubHaptic(chartState);
  };

  return (
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
          right: 8,
          left: 8,
          bottom: 28,
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
          const rawIdx = (chartState as unknown as MouseHandlerDataParam).activeTooltipIndex;
          if (rawIdx == null) return;
          const idx = Number(rawIdx);
          isDraggingRef.current = true;
          dragRangeRef.current = { start: idx, end: idx };
          setDragRange({ start: idx, end: idx });
        }}
        onMouseUp={() => {
          if (!isDraggingRef.current) return;
          isDraggingRef.current = false;
          const drag = dragRangeRef.current;
          dragRangeRef.current = null;
          setDragRange(null);
          if (drag && drag.start !== drag.end) {
            const lo = Math.min(drag.start, drag.end);
            const hi = Math.max(drag.start, drag.end);
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
          isTouchScrubbingRef.current = true;
          setIsChartHovered(true);
          handleChartMove(chartState);
        }}
        onTouchMove={handleChartMove}
        onTouchEnd={() => {
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
        {dragRange && data.length > 0 && (
          <ReferenceArea
            x1={data[Math.min(dragRange.start, dragRange.end)]?.date}
            x2={data[Math.max(dragRange.start, dragRange.end)]?.date}
            fill="var(--primary)"
            fillOpacity={0.1}
            stroke="var(--primary)"
            strokeOpacity={0.4}
          />
        )}
        {data.length > 1 && (
          <Brush
            dataKey="date"
            height={20}
            travellerWidth={10}
            gap={1}
            stroke="#667F0A"
            tickFormatter={(value) => formatDate(value as string)}
            fill="transparent"
            traveller={(props) => {
              // Rounded "pill" handles in place of the default square ones, to match the
              // app's soft fully-rounded UI. Inset vertically for a lighter look.
              const { x, y, width, height } = props;
              return (
                <rect
                  x={x}
                  y={y + 1}
                  width={width}
                  height={Math.max(0, height - 2)}
                  rx={width / 2}
                  ry={width / 2}
                  fill="#667F0A"
                />
              );
            }}
            startIndex={startIndex}
            endIndex={endIndex}
            onChange={(range) => {
              if (range?.startIndex != null && range?.endIndex != null) {
                const si = range.startIndex;
                const ei = range.endIndex;
                setBrushIndices({ startIndex: si, endIndex: ei });
                onVisibleRangeChange?.({ from: data[si].date, to: data[ei].date });
              }
            }}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
