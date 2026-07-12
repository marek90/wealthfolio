# Wealthfolio Custom Changes — Complete Documentation

This document records every change made to the upstream Wealthfolio codebase in this fork. It is intended to allow a fresh LLM coding session to reconstruct all changes, understand the reasoning behind each decision, and avoid known pitfalls.

---

## 1. What This Fork Does

Two UI features were added to the **portfolio history chart** (on both the Dashboard and Account pages), plus a full Docker deployment layer:

1. **Custom date range picker** — a compact calendar-icon bubble that sits inline beside the existing period pills (1D/1W/1M/3M/6M/YTD/1Y/5Y/ALL). Picking a custom range triggers a backend refetch for exactly that window.

2. **Drag-to-select brush zoom** — a Recharts `<Brush>` bar at the bottom of the chart. The user can drag directly on the chart area (not just the brush handles) to zoom into a sub-window. The Y-axis rescales to the zoomed data. The brush is client-side only — no refetch. Zooming updates the gain/loss summary. Double-clicking the chart clears the zoom.

3. **UI polish** — olive color scheme for the brush, app-style formatted date labels, rounded brush corners, active-state indicator on the calendar icon.

4. **Docker deployment** — the app runs as a container on host port 8899.

---

## 2. Architecture Overview (What Already Existed)

Understanding the original structure is essential before making changes.

### Monorepo Layout

```
apps/frontend/          React + Vite frontend (TypeScript)
apps/tauri/             Tauri desktop wrapper (not modified)
apps/server/            Axum HTTP server (not modified)
crates/                 Rust backend crates (not modified)
packages/ui/            Shared component library (@wealthfolio/ui)
```

### The Chart Is Shared Between Two Pages

`apps/frontend/src/components/history-chart.tsx` is the **single** Recharts chart component. It renders on:
- `apps/frontend/src/pages/dashboard/dashboard-content.tsx` (portfolio overview)
- `apps/frontend/src/pages/account/account-page.tsx` (individual account details)

Any change to `history-chart.tsx` automatically applies to both pages.

### Data Flow

```
useValuationHistory(dateRange)       ← backend fetch; undefined = full history
  → valuationHistory
  → chartData (mapped: date, totalValue, netContribution, currency)
  → <HistoryChart data={chartData}>
       <Brush>  ← client-side sub-window of chartData; no refetch
```

The `IntervalSelector` (period pills: 1D/1W/.../ALL) lives in `packages/ui` and is internally state-controlled. **It has no controlled `value` prop** — you cannot force it to show "no selection" from the parent. This is a key constraint.

`useValuationHistory` uses React Query with `keepPreviousData`. Passing `undefined` fetches the full history. The hook already accepts any `{from, to}` DateRange — custom ranges "just work" by setting the page's `dateRange` state.

### Period Pill Highlight Mechanism

The selected-period white bubble is a framer-motion `<div>` with class `bg-background absolute inset-0 -z-10 shadow-sm rounded-full` rendered inside `AnimatedToggleGroup` (in `packages/ui`). It is the only `bg-background absolute` element inside the `IntervalSelector` subtree.

### Y-Axis Scaling

The chart calls `getAutomaticHistoryChartScale(data, opts)` from `history-chart-scale.ts` to compute the Y domain. It is given `visibleData` (the brushed slice), not the full `data` array, so the Y-axis rescales automatically when brushed.

---

## 3. Files Changed

### 3.1 New File: `apps/frontend/src/components/chart-range-picker.tsx`

A compact calendar icon bubble that sits inline beside the period pills.

**Design decisions:**
- Icon-only (no date text on the button) — the selected range shows inside the calendar popover.
- Ghost button variant, `h-8 w-9 rounded-full p-0` — matches the DateRangeSelector trigger style used elsewhere in the app.
- `isActive?: boolean` prop — when true, applies `bg-background text-foreground shadow-sm` to replicate the same "white bubble" highlight the period pills use.
- `numberOfMonths={isMobile ? 1 : 3}` via `useIsMobile()` from `@wealthfolio/ui` — 3 stacked months overflow a phone viewport and made the picker unusable on mobile. One month + react-day-picker's default `<` `>` month nav on phones; 3 months on desktop. Same split `DateRangeSelector` (packages/ui) uses.
- **Draft-range state** — react-day-picker v9 range mode fires `onSelect` with `{from, to: undefined}` on the FIRST tap. Committing that to the parent refetches a degenerate window, the chart empties, and (before the dashboard mount fix, §3.3) the whole controls row incl. the open popover unmounted. The in-progress selection is therefore held in local `draft` state; `onChange` fires only when both `from` and `to` are set. Opening/closing the popover discards the draft and reseeds from `value`.
- PopoverContent gets `max-h-[min(var(--radix-popover-content-available-height,80vh),80vh)] overflow-y-auto` (copied from DateRangeSelector's desktop branch) so the calendar can never overflow the viewport again.
- Uses existing UI primitives from `@wealthfolio/ui` — no new dependencies.
- **i18n**: the trigger's aria-label reuses upstream's existing key `ui:dateRange.chooseCustom` (translated in all 5 languages) with an English fallback default — never hardcode user-facing strings; reuse an upstream key when one exists. The trigger also carries `data-testid="chart-range-picker-trigger"` so e2e selectors are language-independent. Visible dates in our code go through the shared `formatDate()` util (not inline `format(d, "MMM d, yyyy")`) so they inherit upstream's formatting/localization choices automatically.

**Full file:** see `apps/frontend/src/components/chart-range-picker.tsx` (kept in-repo; the listing previously embedded here went stale after the v3.6.0-era calendar fixes — the file itself is the source of truth).

---

### 3.2 Modified: `apps/frontend/src/components/history-chart.tsx`

This is the most heavily modified file. All brush, drag, and zoom logic lives here.

#### Added imports

```tsx
import { Area, AreaChart, Brush, ReferenceArea, ReferenceDot, Tooltip, XAxis, YAxis } from "recharts";
import type { MouseHandlerDataParam } from "recharts/types/synchronisation/types";
```

#### Added prop to interface

```tsx
/** Called when the brush selection changes. Receives the visible date window (YYYY-MM-DD strings),
 *  or undefined when the brush spans the full dataset. Client-side only — no refetch. */
onVisibleRangeChange?: (range: { from: string; to: string } | undefined) => void;
```

#### Brush state (adjust-during-render reset pattern)

```tsx
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
```

**Why adjust-during-render instead of `useEffect`?** Using `useEffect` to reset brush on data change creates a one-render lag: the chart briefly renders with stale indices against new data. Adjusting during render (checking `data !== prevData`) resets atomically in the same render pass. This is the React-recommended pattern for "derived state that resets when a prop changes."

#### Drag tracking state (date strings, not indices)

```tsx
const isDraggingRef = useRef(false);
const didDragRef = useRef(false);
const dragRangeRef = useRef<{ start: string; end: string } | null>(null);
const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null);
```

**Critical lesson:** Drag must be tracked by **date label strings** (not data indices). When the chart is already brush-zoomed, `activeTooltipIndex` becomes view-relative (0 = first visible point), not full-array-relative. So on a second drag within a zoomed window, an index-based approach would map the wrong data points. `activeLabel` (the date string under the cursor) is always the real date, regardless of zoom state.

#### `dateToIndexMap` for O(1) label→index lookup

```tsx
const dateToIndexMap = useMemo(() => {
  const map = new Map<string, number>();
  data.forEach((item, index) => {
    map.set(item.date, index);
  });
  return map;
}, [data]);
```

#### `scaleConfig` and gradient memos receive `visibleData` (Y rescaling)

```tsx
const scaleConfig = useMemo(
  () => getAutomaticHistoryChartScale(visibleData, { ... }),
  [visibleData, scaleMode, netContributionMaxDomainSpanRatio, minDomainSpanRatio],
);

const { zeroOffset, allPositive, allNegative } = useMemo(() => {
  // ... iterates visibleData, not data
}, [visibleData, scaleConfig.domain]);
```

#### `AreaChart` props

```tsx
<AreaChart
  data={data}              // ← always full data; Brush handles the sub-window view
  margin={{ top: 0, right: 8, left: 8, bottom: 28 }}  // right/left 8px insets from screen edge; bottom 28 for brush
  onDoubleClick={() => {
    if (brushIndices) {
      setBrushIndices(null);
      onVisibleRangeChange?.(undefined);
    }
  }}
  onMouseDown={(chartState) => {
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
  onMouseLeave={() => {
    // ... existing hover cleanup ...
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      dragRangeRef.current = null;
      setDragRange(null);
    }
  }}
>
```

**Why cast `onMouseDown` state?** Recharts v3 types `onMouseDown`'s first argument as `MouseHandlerDataParam` but the actual runtime value also has `activeLabel`. The cast `(chartState as unknown as MouseHandlerDataParam)` works around the type definition gap.

**`didDragRef`** prevents a click-after-drag from firing the marker click handler. Set to `true` on mouseup after a drag; the `onClick` handler checks it and clears it.

#### `handleChartMove` drag tracking

```tsx
const handleChartMove = (chartState: MouseHandlerDataParam) => {
  // ... existing marker hover logic ...

  if (isDraggingRef.current && chartState.activeLabel != null) {
    const newEnd = String(chartState.activeLabel);
    dragRangeRef.current = dragRangeRef.current ? { ...dragRangeRef.current, end: newEnd } : null;
    setDragRange((prev) => (prev ? { ...prev, end: newEnd } : null));
  }

  maybeTriggerScrubHaptic(chartState);
};
```

#### `ChartContainer` marker class

```tsx
<ChartContainer
  config={chartConfig}
  className="history-brush h-full w-full"  // "history-brush" scopes CSS overrides in globals.css
  data-no-swipe-drag
>
```

#### `ReferenceArea` for live drag overlay (IIFE pattern)

```tsx
{dragRange &&
  data.length > 0 &&
  (() => {
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
```

The IIFE (immediately invoked function expression) is needed because JSX doesn't allow `if`/`const` inline. The labels are mapped back to full-data indices via `dateToIndexMap` so the `ReferenceArea` x1/x2 are real dates that Recharts can place correctly.

#### `Brush` component

```tsx
{data.length > 1 && (
  <Brush
    dataKey="date"
    height={20}
    travellerWidth={10}
    gap={1}
    stroke="#667F0A"           // olive color — controls handles AND edge date labels
    tickFormatter={(value) => formatDate(value as string)}  // "Jun 18, 2025" format
    fill="transparent"
    traveller={(props) => {
      // Custom rounded pill handles (SVG rect with rx=width/2 = fully circular)
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
```

**Brush learnings:**
- `stroke` is one prop that controls both the traveller handle outlines AND the edge date label text color. There is no separate text color prop.
- `traveller` prop accepts a render function `(props: {x, y, width, height, stroke}) => ReactElement<SVGElement>`. Return an SVG element (must be a valid SVG primitive).
- `fill="transparent"` makes the brush body invisible so only the handles and the slide rect are visible.
- The `tickFormatter` receives the raw `dataKey` value (a YYYY-MM-DD date string) and should return a human-readable string.
- `data.length > 1` guard prevents rendering the brush on empty or single-point charts.
- `onChange` fires continuously while dragging the slider handles. React Query dedupes identical query keys so rapid index changes don't cause a refetch storm.

---

### 3.3 Modified: `apps/frontend/src/pages/dashboard/dashboard-content.tsx`

#### New state

```tsx
const [brushDisplayRange, setBrushDisplayRange] = useState<DateRange | undefined>(undefined);
const [isCustomRangeActive, setIsCustomRangeActive] = useState<boolean>(false);
```

#### ALL preset date clamping (display-only fix)

```tsx
const firstDataDate = chartData[0]?.date;
const pickerValue = useMemo<DateRange | undefined>(() => {
  if (!dateRange?.from || !firstDataDate) return dateRange;
  const earliest = new Date(firstDataDate);
  return dateRange.from < earliest ? { from: earliest, to: dateRange.to } : dateRange;
}, [dateRange, firstDataDate]);
```

**Why:** `getInitialIntervalData("ALL")` returns `1970-01-01` as the sentinel start date. Showing `Jan 1, 1970` in the calendar picker is confusing. This clamps the *displayed* value to the first real data point. It does NOT change what `useValuationHistory` fetches — the hook still uses raw `dateRange`.

#### Performance summary uses brush window when active

```tsx
const perfFrom = brushDisplayRange?.from ?? (!isAllTime ? dateRange?.from : undefined);
const perfTo = brushDisplayRange?.to ?? (!isAllTime ? dateRange?.to : undefined);
const startDate = perfFrom ? format(perfFrom, "yyyy-MM-dd") : undefined;
const endDate = perfTo ? format(perfTo, "yyyy-MM-dd") : undefined;
const datesReady = (isAllTime && !brushDisplayRange) || (!!startDate && !!endDate);
```

**Why this works independently:** The performance summary is a separate React Query (`calculatePerformanceSummary`) keyed on `startDate`/`endDate`. The chart data fetch (`useValuationHistory`) is keyed on `dateRange`/`isAllTime`. They are completely independent — overriding only the summary dates causes the summary to refetch for the brushed window while the chart data remains unchanged.

#### Period description shows brush window

```tsx
{(selectedIntervalDescription || brushDisplayRange) && (
  <span className="lg:text-md text-muted-foreground ml-1 text-sm font-light">
    {brushDisplayRange?.from && brushDisplayRange?.to
      ? `${format(brushDisplayRange.from, "MMM d, yyyy")} – ${format(brushDisplayRange.to, "MMM d, yyyy")}`
      : selectedIntervalDescription}
  </span>
)}
```

#### `handleIntervalSelect` clears brush and custom range state

```tsx
const handleIntervalSelect = (code, description, range) => {
  setSelectedInterval(code);
  setSelectedIntervalDescription(description);
  setDateRange(range);
  setIsAllTime(code === "ALL");
  setBrushDisplayRange(undefined);
  setIsCustomRangeActive(false);
};
```

#### `handleCustomRangeChange` sets the same `dateRange` state as the pills

```tsx
const handleCustomRangeChange = (range: { from?: Date; to?: Date } | undefined) => {
  if (!range?.from || !range?.to) return; // never let a half-open range trigger a refetch
  setDateRange({ from: range.from, to: range.to });
  setIsAllTime(false);
  setBrushDisplayRange(undefined);
  setIsCustomRangeActive(true);
};
```

(v3.6.0 note: upstream deleted `selectedIntervalDescription`; the period label is now derived at render time — priority `brushDisplayRange` → custom range from `dateRange` when `isCustomRangeActive` → `t(\`ui:interval.${selectedInterval}\`)`.)

#### Controls row is NOT gated on `chartData.length`

```tsx
{valuationHistory && (   // deliberately not `&& chartData.length > 0`
  <div className="flex w-full -translate-y-6 items-center justify-center gap-2 px-4">
```

If a picked range legitimately returns no points, the pills + calendar must stay mounted or the user has no way to recover (this was the "calendar tap makes everything vanish" bug).

#### Chart controls layout (inline row)

```tsx
{valuationHistory && chartData.length > 0 && (
  <div className="flex w-full -translate-y-6 items-center justify-center gap-2 px-4">
    <IntervalSelector
      className={`pointer-events-auto relative z-20 w-auto max-w-full ${
        isCustomRangeActive ? "interval-pill-suppressed" : ""
      }`}
      onIntervalSelect={handleIntervalSelect}
      onHaptic={triggerHaptic}
      isLoading={isValuationHistoryLoading}
      storageKey={INTERVAL_STORAGE_KEY}
      defaultValue={DEFAULT_INTERVAL}
    />
    <ChartRangePicker
      className="pointer-events-auto relative z-20 shrink-0"
      value={brushDisplayRange ?? pickerValue}
      onChange={handleCustomRangeChange}
      isActive={isCustomRangeActive}
    />
  </div>
)}
```

**Key layout note:** `w-auto max-w-full` on `IntervalSelector` overrides its hardcoded `w-full` because the app uses `cn()` which is `twMerge(clsx())` — later classes win over earlier ones. This allows the pills to shrink to their natural width so the calendar icon sits right next to the last pill.

**`interval-pill-suppressed`** is a plain class name (not a Tailwind arbitrary variant) used as a marker for the globals.css rule that hides the period pill's framer-motion highlight bubble when a custom calendar range is active.

**`value={brushDisplayRange ?? pickerValue}`** — when the brush is zoomed, the calendar picker bubble displays the brushed window. When no brush, it shows the current period's date range (with the 1970 ALL sentinel clamped to first-data-date).

#### Chart container height

```tsx
<div className="h-80">
  <HistoryChart ... />
```

Increased from upstream's `h-70` (280px) to `h-80` (320px) to make room for the brush bar at the bottom.

#### `onVisibleRangeChange` wiring

```tsx
<HistoryChart
  ...
  onVisibleRangeChange={(r) =>
    setBrushDisplayRange(r ? { from: new Date(r.from), to: new Date(r.to) } : undefined)
  }
/>
```

Converts YYYY-MM-DD strings to `Date` objects for `brushDisplayRange`.

---

### 3.4 Modified: `apps/frontend/src/pages/account/account-page.tsx`

Same pattern as dashboard but adapted to this page's simpler state structure.

#### New state

```tsx
const [brushDisplayRange, setBrushDisplayRange] = useState<DateRange | undefined>(undefined);
const [isCustomRangeActive, setIsCustomRangeActive] = useState<boolean>(false);
```

#### Performance date range with brush override

```tsx
const isBrushed = !!brushDisplayRange;
const performanceDateRange = isBrushed
  ? brushDisplayRange
  : getPerformanceDateRangeForRequest(dateRange, selectedIntervalCode);
```

#### `gainLossAmountToDisplay`, `gainLossCurrencyToDisplay`, `percentageToDisplay`

These derive the displayed gain/loss values. They use `effectiveAllTime = selectedIntervalCode === "ALL" && !isBrushed` instead of `selectedIntervalCode === "ALL"` so that an ALL-period brush zoom shows numbers for the brushed window rather than the all-time stats.

#### `handleIntervalSelect` clears brush state

```tsx
const handleIntervalSelect = (code, _desc, range) => {
  setSelectedIntervalCode(code);
  setDateRange(range);
  setBrushDisplayRange(undefined);
  setIsCustomRangeActive(false);
};
```

#### `handleCustomRangeChange`

```tsx
const handleCustomRangeChange = (range: { from?: Date; to?: Date } | undefined) => {
  if (!range?.from || !range?.to) return; // never let a half-open range trigger a refetch
  setDateRange({ from: range.from, to: range.to });
  setBrushDisplayRange(undefined);
  setIsCustomRangeActive(true);
};
```

#### IntervalSelector with `interval-pill-suppressed` marker

```tsx
<IntervalSelector
  className={`z-10 w-auto max-w-full ${isCustomRangeActive ? "interval-pill-suppressed" : ""}`}
  ...
/>
```

#### `ChartRangePicker` inline with pills

```tsx
<ChartRangePicker
  className="shrink-0"
  value={brushDisplayRange ?? pickerValue}
  onChange={handleCustomRangeChange}
  isActive={isCustomRangeActive}
/>
```

#### `onVisibleRangeChange` wiring

```tsx
<HistoryChart
  ...
  onVisibleRangeChange={(r) =>
    setBrushDisplayRange(r ? { from: new Date(r.from), to: new Date(r.to) } : undefined)
  }
/>
```

#### Controls row layout (account-specific fixes)

The account page chart lives inside a `Card` / `CardContent`, which clips its visual boundary at the `h-130` container height. The dashboard chart floats in an open gradient background where overflow is invisible. Two layout fixes were needed that the dashboard did not require:

**Fix 1 — `bottom-10` → `bottom-6` on the controls wrapper** (fixes brush/button overlap and ungrabbable handles):

```tsx
// Before (40px up — rode into the brush band):
<div className="relative bottom-10 flex items-center justify-center gap-2 px-4">

// After (24px up — matches the dashboard's clearance):
<div className="relative bottom-6 flex items-center justify-center gap-2 px-4">
```

At 40px the controls row overlapped the brush bar visually, and its full-width hit area intercepted clicks on the pill travellers at the left/right edges. At 24px the row clears the brush, matching the dashboard geometry exactly.

**Fix 2 — `pb-8` on the flex-column wrapper** (fixes controls sitting below the card's visible border):

```tsx
// Before:
<div className="flex w-full flex-col">

// After:
<div className="flex w-full flex-col pb-8">
```

The `h-130` (520px) chart fills its container completely. The controls div (rendered after the chart in flow, ~36px tall, shifted up 24px) had its bottom edge at ~532px — 12px outside the card boundary. Adding `pb-8` (32px) extends the card's visible area to 552px, pulling the controls and the framer-motion highlight bubble fully inside the card border. The chart itself is not affected (it still fills its own `h-130` container).

---

### 3.5 Modified: `apps/frontend/src/globals.css`

Two blocks were added at the end of the file.

#### Period pill suppressor

```css
/* Portfolio history chart — when a custom calendar range is the active selection,
   hide the period-pill "white bubble" indicator (the framer-motion element is the only
   bg-background.absolute node inside the IntervalSelector). !important beats any inline
   style and avoids relying on a Tailwind arbitrary variant being generated. */
.interval-pill-suppressed .bg-background.absolute {
  opacity: 0 !important;
}
```

**Why `!important`:** The framer-motion animated highlight div may have inline `style` attributes for its animation. CSS specificity alone is not enough to override inline styles. `!important` guarantees the rule wins.

**Why globals.css instead of Tailwind arbitrary variant:** Tailwind arbitrary variants like `[&_.bg-background.absolute]:opacity-0` must be present in the source code in a form that Tailwind's scanner can detect at build time. If the class is only conditionally assembled via a template literal or `cn()`, it may not be extracted. Worse, even if extracted, it generates a regular CSS rule that cannot beat framer-motion's inline styles. The globals.css approach is more reliable: it's always compiled (not scanned), and `!important` beats inline.

#### Brush corner rounding

```css
/* Portfolio history chart brush — soften the default blocky brush to match the rounded UI.
   Rounds both the selected-window slide and the outer background frame (direct rect children
   of .recharts-brush; the pill travellers live in nested layers and are unaffected). */
.history-brush .recharts-brush-slide {
  rx: 6px;
  ry: 6px;
}
.history-brush .recharts-brush > rect:not(.recharts-brush-slide) {
  rx: 8px;
  ry: 8px;
}
```

**DOM structure of `.recharts-brush`:**
```
.recharts-brush (g)
  rect                         ← outer background frame (no class)
  .recharts-brush-slide (rect) ← selected window highlight
  g (Layer)                    ← traveller handles (nested, NOT direct rect children)
  g (Layer)                    ← date text labels (nested)
```

`.recharts-brush > rect` selects only the two direct-child `rect` elements. `:not(.recharts-brush-slide)` narrows to just the outer frame. SVG `rx`/`ry` via CSS works in all modern browsers.

**Why `history-brush` marker class on ChartContainer:** `ChartContainer` (from `packages/ui`) forwards its `className` to a wrapper `<div>`, so `.history-brush .recharts-brush-slide` correctly scopes the rules to only this chart and not any other Recharts charts on other pages.

---

## 4. Docker Deployment

### Setup (one-time)

```bash
mkdir -p ./secrets ./data
sudo chown -R 1000:1000 ./data

# Generate a secret key (back this up — losing it loses broker/API credentials)
openssl rand -base64 32 > ./secrets/wf_secret_key

# Install argon2 if needed
sudo apt-get install argon2

# Generate password hash (use printf NOT echo -n to avoid trailing newline)
printf 'your-password-here' | argon2 'yoursalt16chars!' -id -e > ./secrets/wf_auth_password_hash
```

### `./secrets/.env.docker`

```env
WF_LISTEN_ADDR=0.0.0.0:8088
WF_DB_PATH=/data/wealthfolio.db
WF_SECRET_KEY=<contents of ./secrets/wf_secret_key>
WF_AUTH_PASSWORD_HASH=<contents of ./secrets/wf_auth_password_hash>
WF_CORS_ALLOW_ORIGINS=http://localhost:8899
```

**Important:** Do NOT single-quote the hash value in `.env.docker`. Docker's `--env-file` reads the file literally (no shell processing), so quotes are included as literal characters and break authentication. The `$` in the Argon2 hash string does NOT get interpolated when using `--env-file`.

**Important:** The `WF_AUTH_PASSWORD_HASH` value contains `$` characters. When using `printf` to generate it, no trailing newline is added — unlike `echo` which always adds one.

### Build and Run

```bash
docker build -t wealthfolio-custom .

docker run -d --name wealthfolio-custom \
  --env-file ./secrets/.env.docker \
  -p 8899:8088 \
  -v "$(pwd)/data":/data \
  wealthfolio-custom

# Verify
curl -fsS http://localhost:8899/api/v1/healthz
```

### Rebuild After Code Changes

```bash
docker rm -f wealthfolio-custom
docker build -t wealthfolio-custom .
docker run -d --name wealthfolio-custom \
  --env-file ./secrets/.env.docker \
  -p 8899:8088 \
  -v "$(pwd)/data":/data \
  wealthfolio-custom
curl -fsS http://localhost:8899/api/v1/healthz
```

### Root `.env` File

Create a root-level `.env` (gitignored) with dummy values to prevent `docker compose` from complaining about undefined variables if you ever run `docker compose down`:

```env
WF_LISTEN_ADDR=
WF_DB_PATH=
WF_SECRET_KEY=
WF_AUTH_PASSWORD_HASH=
WF_CORS_ALLOW_ORIGINS=
```

### Files to Never Commit

- `./secrets/` — contains the secret key and password hash
- `./data/` — contains the database

Both are in `.gitignore`.

---

## 5. Lessons Learned and Technical Gotchas

### 5.1 Tailwind v4 Arbitrary Variants Are Unreliable for This Use Case

**Do not use** `[&_.bg-background.absolute]:opacity-0` (or similar arbitrary descendant variants) to suppress the framer-motion period pill highlight. Two failure modes:

1. Tailwind's content scanner may not extract the class if it's only assembled via string interpolation or `cn()`.
2. Even if the class is extracted, it produces a regular CSS rule that cannot beat framer-motion's inline `style` attribute.

**Use globals.css with `!important` and a plain marker class instead.** This approach is consistent with how the existing codebase handles other CSS overrides (toasts, heatmap, lever slider).

### 5.2 SVG `rx`/`ry` via CSS Works (In Modern Browsers)

SVG attributes `rx` and `ry` can be set via CSS in all modern browsers. Recharts does not expose a `rx` prop on `<Brush>`, but you can target its `rect` children with CSS. This is how brush corner rounding is achieved.

### 5.3 Brush `stroke` Controls Both Handles and Edge Labels

There is no separate color prop for the brush's edge date label text. The `stroke` prop is the single control for the handle border color AND the edge date label text color. Setting `stroke="#667F0A"` (olive) makes both olive-colored.

### 5.4 `activeTooltipIndex` Is View-Relative, Not Full-Array-Relative

When the chart is brush-zoomed, Recharts reports `activeTooltipIndex` as the index within the currently visible slice (0 = first visible point). If you use this to index into the full `data` array, you get wrong results on any drag after the first zoom.

**Always use `activeLabel`** (the date string) for position tracking, then convert back to full-array indices via `dateToIndexMap`. This is reliable regardless of zoom state.

### 5.5 `packages/ui` Must Not Be Modified

The `IntervalSelector` component in `packages/ui` has no controlled `value` prop (it's internally stateful). There is no clean way to tell it "show no pill highlighted" from the parent without modifying `packages/ui`. The workaround is the globals.css `interval-pill-suppressed` marker class approach — the parent adds a CSS class to the IntervalSelector wrapper that hides the animated highlight.

### 5.6 `cn()` = `twMerge(clsx())` — Later Classes Override Earlier Ones

`IntervalSelector` has `className="w-full"` hardcoded inside it. Passing `className="w-auto max-w-full"` from the parent overrides it because `cn()` (which the component uses internally) is `twMerge(clsx())`. `twMerge` resolves Tailwind class conflicts in favor of the last class in the merge. This is why `w-auto max-w-full` successfully overrides the internal `w-full`.

### 5.7 Adjust-During-Render vs. `useEffect` for Brush Reset

Resetting brush state when `data` changes must happen **during render** (not in `useEffect`) to avoid a one-render flicker. The pattern is:

```tsx
const [prevData, setPrevData] = useState(data);
if (data !== prevData) {
  setPrevData(data);
  setBrushIndices(null);
}
```

React detects that `setPrevData` and `setBrushIndices` were called during render, re-renders immediately with the new values, and the chart never shows the old indices with new data.

### 5.8 Performance Summary and Chart Data Are Independent React Queries

The chart data (`useValuationHistory`) and the gain/loss summary (`calculatePerformanceSummary`) are separate React Query instances with different keys. Updating the summary's date range (for the brushed window) does NOT refetch the chart data. This is what makes the client-side brush + server-side summary recalc possible without a chart refetch.

### 5.9 `onVisibleRangeChange` Must NOT Be Called During Render

React prohibits calling a parent state setter during the render phase of a child. The brush reset (`setBrushIndices(null)` triggered by `data !== prevData`) must **not** also call `onVisibleRangeChange`. The caller (parent) is responsible for clearing `brushDisplayRange` when it changes the period — which it does in `handleIntervalSelect` and `handleCustomRangeChange`.

### 5.10 Recharts v3.7.0 — `MouseHandlerDataParam` Type Gap

The `onMouseDown` event handler in Recharts v3 does not correctly type its first argument as `MouseHandlerDataParam` in all code paths. Cast as `(chartState as unknown as MouseHandlerDataParam)` to access `.activeLabel`. This is a type-definition gap, not a runtime issue.

### 5.11 Docker Build Is Slow on First Run (Rust Compilation)

The Dockerfile cross-compiles Rust for the host architecture. On an arm64 host (e.g., the Raspberry Pi / Oracle ARM VM where this runs), the first build takes 10–20 minutes. Subsequent builds cache Rust dependencies via Docker layer caching. Only change frontend files when possible to avoid invalidating the Rust layer.

### 5.12 Account-Page Chart Container Requires Extra Layout Care

The dashboard and account page look similar but have a critical structural difference:
- **Dashboard**: `HistoryChart` + controls row sit inside a `h-80` (320px) div that lives in an **open gradient background** — overflow is invisible and nothing clips it.
- **Account**: the same elements sit inside a `Card` / `CardContent`, which has a visible border. Anything that overflows the card's height is outside that border and looks broken.

This means the controls row shift must clear the brush (fix: `bottom-6` not `bottom-10`), AND the card container must be tall enough to keep the controls within its visible border (fix: `pb-8` on the flex-column wrapper).

**Rule of thumb:** if a future change makes the chart taller or the controls taller, check the account page separately — a change that looks fine on the dashboard may overflow the card on the account page.

### 5.13 `argon2` Hash Contains `$` — Shell Interpolation Risk

The Argon2 password hash has the format `$argon2id$v=19$m=...$...`. If you put this in a shell script or a `.env` file sourced by a shell, the `$` characters will be interpolated. Mitigations:
- Use `printf` (not `echo -n`) to generate the hash — avoids trailing newline.
- Use `--env-file` with Docker (not `-e`) — Docker reads the file literally, no shell expansion.
- Never single-quote the value in `.env.docker` — Docker doesn't do shell quoting in env files.

---

## 6. File Change Summary

| File | Status | Purpose |
|------|--------|---------|
| `apps/frontend/src/components/chart-range-picker.tsx` | **New** | Compact calendar-icon bubble date range picker |
| `apps/frontend/src/components/history-chart.tsx` | Modified | Brush, drag-to-zoom, Y rescaling, drag overlay |
| `apps/frontend/src/pages/dashboard/dashboard-content.tsx` | Modified | Calendar picker integration, brush echo, pill suppression |
| `apps/frontend/src/pages/account/account-page.tsx` | Modified | Same as dashboard, adapted for account page state |
| `apps/frontend/src/globals.css` | Modified | CSS overrides for pill suppression and brush rounding |
| `packages/ui/src/components/financial/interval-selector.tsx` | Modified | Mobile: horizontal touch-scroll for the pill row inside the Embla carousel (commit 90d5c4e4) |
| `./secrets/.env.docker` | New (gitignored) | Docker environment variables |
| `.gitignore` | Modified | Added `secrets/`, `data/`, `.env` |

### `packages/ui` exception — interval-selector.tsx

The original constraint was to never edit the shared UI library, and the pill-highlight
suppression still uses the globals.css workaround for that reason. One exception was
later made (commit 90d5c4e4): `interval-selector.tsx` needed a JS touch handler +
class changes to make the pill row horizontally scrollable on mobile inside the
dashboard's Embla carousel (`touch-action: pan-y` on carousel descendants blocks native
horizontal panning). See the commit message for the full mechanism.

### Files Explicitly Not Modified

- `packages/ui/` — any other file.
- `apps/tauri/` — any file.
- `crates/` — any Rust file.
- `apps/server/` — any file.

---

## 7. Quick Reconstruction Guide

If starting from a clean clone of the fork, here is the minimal sequence to restore all changes:

1. Create `apps/frontend/src/components/chart-range-picker.tsx` (full content in section 3.1).

2. Edit `apps/frontend/src/components/history-chart.tsx`:
   - Add `Brush`, `ReferenceArea` to recharts import.
   - Add `MouseHandlerDataParam` type import.
   - Add `onVisibleRangeChange?` prop.
   - Add `brushIndices` state + adjust-during-render reset.
   - Add `visibleData` memo.
   - Add drag state (`isDraggingRef`, `didDragRef`, `dragRangeRef`, `dragRange`).
   - Change `scaleConfig` and `zeroOffset` memos to use `visibleData`.
   - Add `dateToIndexMap` memo.
   - Change `ChartContainer className` to include `history-brush`.
   - Add `margin={{right:8, left:8, bottom:28}}` to `AreaChart`.
   - Add `onDoubleClick`, `onMouseDown`, `onMouseUp` to `AreaChart` (extend existing `onMouseLeave`).
   - Add drag tracking to `handleChartMove`.
   - Add `ReferenceArea` IIFE render.
   - Add `Brush` with olive color, formatted labels, rounded traveller prop.

3. Edit `apps/frontend/src/pages/dashboard/dashboard-content.tsx`:
   - Import `ChartRangePicker`.
   - Add `brushDisplayRange` and `isCustomRangeActive` state.
   - Add `firstDataDate` + `pickerValue` memo (1970 clamping).
   - Update `handleIntervalSelect` to clear brush and custom range state.
   - Add `handleCustomRangeChange`.
   - Update performance summary derivation to use `brushDisplayRange`.
   - Update period description to show brush window.
   - Change `IntervalSelector` className to `w-auto max-w-full` + conditional `interval-pill-suppressed`.
   - Add `ChartRangePicker` inline beside IntervalSelector.
   - Increase chart container to `h-80` (320px).
   - Pass `onVisibleRangeChange` to `HistoryChart`.

4. Edit `apps/frontend/src/pages/account/account-page.tsx`: Same pattern as dashboard (section 3.4), plus two account-specific layout fixes:
   - Controls wrapper: `relative bottom-6` (not `bottom-10`) so it clears the brush bar.
   - Flex-column wrapper around the chart: add `pb-8` so the controls sit inside the card's visible border.

5. Append to `apps/frontend/src/globals.css`:
   - `.interval-pill-suppressed .bg-background.absolute { opacity: 0 !important; }`
   - `.history-brush .recharts-brush-slide { rx: 6px; ry: 6px; }`
   - `.history-brush .recharts-brush > rect:not(.recharts-brush-slide) { rx: 8px; ry: 8px; }`

6. Set up Docker secrets and build (section 4).

---

## 8. Feature Behavior Reference

| Interaction | Result |
|-------------|--------|
| Click a period pill (1D/1W/.../ALL) | Refetches chart data for that period; clears brush; clears calendar active state |
| Pick a date range in calendar | Refetches chart data for that exact range; sets calendar icon as active (white bubble); hides period pill's bubble |
| Drag on chart area | Shows gray overlay while dragging; on mouseup, zooms chart (Y rescales); updates gain/loss summary |
| Drag brush handles | Zooms chart (Y rescales); updates gain/loss summary |
| Double-click chart | Clears brush zoom; restores full dataset view |
| Brush active → drag again | Gray overlay shows correctly (label-based tracking works inside brush zoom) |
| Switch period while brushed | Brush clears; chart refetches for new period |
| Switch period while calendar active | Brush clears; calendar active state clears; period pill gets the bubble |

---

## 9. Upstream v3.6.0 Merge (2026-07-05)

Upstream v3.6.0 (i18n in 5 languages, MCP agent access, short positions, activity
taxes, split transactions, rebalancer phase 2, Health Center rebuild — 200 commits)
was merged into the fork with `git merge v3.6.0`. Pre-merge state is preserved on
branch `backup/pre-v3.6.0` (commit 90d5c4e4).

Only 2 files had textual conflicts; resolutions:

- **history-chart.tsx** — imports only: upstream added `useTranslation`, we have
  `Brush`/`ReferenceArea`. Took both. Upstream's i18n `t()` calls in the tooltip and
  `chartConfig` labels auto-merged around our brush code.
- **dashboard-content.tsx** — three hunks:
  1. Upstream **deleted `selectedIntervalDescription` state** (labels now come from
     `t(\`ui:interval.${code}\`)`). Our custom-range/brush description was reworked to a
     render-time derivation — priority: `brushDisplayRange` → `dateRange` when
     `isCustomRangeActive` → `t(\`ui:interval.${selectedInterval}\`)`. The
     `setSelectedIntervalDescription` call in `handleCustomRangeChange` was dropped.
  2. Chart height: upstream `h-70` (280px) vs our 320px — kept 320px as `h-80`.
  3. Controls row: kept our `-translate-y-6 items-center gap-2 px-4` version.
  Upstream's gradient-to-inline-style change and `pt-14` spacing were taken as-is.
- Auto-merged with both sides intact: `account-page.tsx` (upstream pure i18n),
  `interval-selector.tsx` (upstream i18n `title` line + our touch-scroll block),
  `.gitignore`.
- `globals.css`, `compose.yml`, `Dockerfile` were untouched by upstream.

At the same time two calendar-picker bugs were fixed (see §3.1): mobile month count
and the half-open-range refetch; plus the dashboard controls row is no longer gated
on `chartData.length` (see §3.3).

---

## 10. Upstream v3.6.1 Merge (2026-07-12)

Upstream v3.6.1 (24 commits: addon-SDK sidebar icon set, MCP asset-classification
write tool, provider-quote prioritization in storage-sqlite, relaxed health
stale-price threshold, Keycloak dev realm, Windows installer CI, docs) was merged
with `git merge v3.6.1`. Pre-merge state is on branch `backup/pre-v3.6.1`
(commit beeda685).

- **Zero conflicts.** Pre-merge impact analysis (GitHub compare API
  `v3.6.0...v3.6.1` vs `git diff --name-only v3.6.0..main`) showed an empty
  intersection — upstream touched none of our custom files. The auto-merge was
  clean; all custom fingerprints (`Brush`, `ReferenceArea`, `onVisibleRangeChange`,
  `interval-pill-suppressed`, `scrollRef`, `chart-range-picker`) verified present
  after the merge.
- **Pre-existing test failure fixed** (commit after the merge): the mobile
  calendar fix (fff577d9) made `ChartRangePicker` call `useIsMobile()` from
  `@wealthfolio/ui`, but `dashboard-content.test.tsx` and `account-page.test.tsx`
  mock that module with explicit factories that lacked the export — 9 tests
  crashed on render. Verified failing on `backup/pre-v3.6.1` too (not a merge
  regression). Fix: added `useIsMobile: () => false` to both mock factories.
  **Lesson:** when adding a new `@wealthfolio/ui` import to a component rendered
  by the dashboard/account pages, extend the `vi.mock("@wealthfolio/ui", ...)`
  factories in both page test files.
- Gates after merge: `pnpm type-check` clean, `pnpm test` 1018/1018 green,
  E2E `90-chart-calendar` 3/3 green against a disposable container of the
  rebuilt image.
- DB backup before the new version's migrations: `data/wealthfolio.db.pre-v3.6.1.bak`.

---

*Last updated: 2026-07-12. Covers all changes through the v3.6.1 merge.*
