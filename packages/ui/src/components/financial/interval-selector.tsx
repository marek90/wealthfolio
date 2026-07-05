import { AnimatedToggleGroup } from "../ui/animated-toggle-group";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../../hooks/use-mobile";
import { usePersistentState } from "../../hooks/use-persistent-state";
import { cn } from "../../lib/utils";
import { startOfYear, subDays, subMonths, subWeeks, subYears } from "date-fns";
import React, { useCallback, useEffect, useRef, useState } from "react";

export type TimePeriod = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "ALL";
export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface IntervalData {
  code: TimePeriod;
  description: string;
  calculateRange: () => DateRange | undefined;
}

const intervalDescriptions: Record<TimePeriod, string> = {
  "1D": "past day",
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  YTD: "year to date",
  "1Y": "past year",
  "5Y": "past 5 years",
  ALL: "All Time",
};

const intervals: IntervalData[] = [
  {
    code: "1D",
    description: intervalDescriptions["1D"],
    calculateRange: () => ({ from: subDays(new Date(), 1), to: new Date() }),
  },
  {
    code: "1W",
    description: intervalDescriptions["1W"],
    calculateRange: () => ({ from: subWeeks(new Date(), 1), to: new Date() }),
  },
  {
    code: "1M",
    description: intervalDescriptions["1M"],
    calculateRange: () => ({ from: subMonths(new Date(), 1), to: new Date() }),
  },
  {
    code: "3M",
    description: intervalDescriptions["3M"],
    calculateRange: () => ({ from: subMonths(new Date(), 3), to: new Date() }),
  },
  {
    code: "6M",
    description: intervalDescriptions["6M"],
    calculateRange: () => ({ from: subMonths(new Date(), 6), to: new Date() }),
  },
  {
    code: "YTD",
    description: intervalDescriptions.YTD,
    calculateRange: () => ({ from: startOfYear(new Date()), to: new Date() }),
  },
  {
    code: "1Y",
    description: intervalDescriptions["1Y"],
    calculateRange: () => ({ from: subYears(new Date(), 1), to: new Date() }),
  },
  {
    code: "5Y",
    description: intervalDescriptions["5Y"],
    calculateRange: () => ({ from: subYears(new Date(), 5), to: new Date() }),
  },
  {
    code: "ALL",
    description: intervalDescriptions.ALL,
    calculateRange: () => ({ from: new Date("1970-01-01"), to: new Date() }),
  },
];

const DEFAULT_INTERVAL_CODE: TimePeriod = "3M";

/** Get interval data for a given period code */
const getIntervalData = (code: TimePeriod) => {
  return intervals.find((i) => i.code === code) ?? intervals.find((i) => i.code === DEFAULT_INTERVAL_CODE)!;
};

interface IntervalSelectorProps {
  onIntervalSelect: (code: TimePeriod, description: string, range: DateRange | undefined) => void;
  className?: string;
  isLoading?: boolean;
  defaultValue?: TimePeriod;
  /** LocalStorage key to persist selection. When provided, selection is persisted. */
  storageKey?: string;
  /** Optional callback for haptic feedback */
  onHaptic?: () => void;
}

const IntervalSelector: React.FC<IntervalSelectorProps> = ({
  onIntervalSelect,
  className,
  defaultValue = DEFAULT_INTERVAL_CODE,
  storageKey,
  onHaptic,
}) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // State for selection - persisted or local
  const [persistedValue, setPersistedValue] = usePersistentState<TimePeriod>(
    storageKey ?? "__interval_selector__",
    defaultValue,
  );
  const [localValue, setLocalValue] = useState<TimePeriod>(defaultValue);

  const currentValue = storageKey ? persistedValue : localValue;

  const handleValueChange = useCallback(
    (value: TimePeriod) => {
      // Update state
      if (storageKey) {
        setPersistedValue(value);
      } else {
        setLocalValue(value);
      }
      // Notify parent
      const data = getIntervalData(value);
      onIntervalSelect(data.code, data.description, data.calculateRange());
      // Trigger haptic feedback
      onHaptic?.();
    },
    [onIntervalSelect, storageKey, setPersistedValue, onHaptic],
  );

  const items = intervals.map((interval) => ({
    value: interval.code,
    label: interval.code,
    title: t("ui:interval." + interval.code, interval.description),
  }));

  // Native horizontal touch-scroll is impossible when this lives inside the dashboard's
  // Embla carousel: the carousel viewport sets `touch-action: pan-y`, which intersects with
  // any descendant value to block horizontal panning (pan-x ∩ pan-y = ∅). So we drive the
  // scroll ourselves: stop the touch from reaching Embla (no tab swipe) and set scrollLeft
  // directly on each move. Requires `touch-pan-y` + no `scroll-smooth` on the element above.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startX = 0, startY = 0, startScrollLeft = 0;
    const onTouchStart = (e: TouchEvent) => {
      // Stop the touch from reaching the parent Embla carousel's viewport listener,
      // so dragging the pills never triggers a tab swipe (data-no-swipe-drag is
      // unreliable here because the scroll div opts in/out of pointer-events).
      e.stopPropagation();
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollLeft = el.scrollLeft;
    };
    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (Math.abs(dx) < 4 || Math.abs(dy) > Math.abs(dx)) return;
      e.preventDefault();
      el.scrollLeft = startScrollLeft - dx;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return (
    <div className={cn("pointer-events-none relative w-full min-w-0", className)}>
      <div
        ref={scrollRef}
        // Prevents Embla Carousel (SwipableView) from intercepting horizontal drags
        // so the pill scroll works inside swipable dashboard tabs.
        data-no-swipe-drag
        className={cn(
          // `overflow-x-auto!` (important) overrides the unlayered global
          // `@media (max-width:1024px) .flex { overflow-x: hidden }` rule in globals.css,
          // which otherwise clips the scrollable pills (5Y/ALL) on mobile portrait.
          // `justify-center-safe` keeps centering when they fit but left-aligns + scrolls when they overflow.
          // `pointer-events-auto`: the strip must own the touch so it scrolls and blocks the tab-swipe carousel.
          "pointer-events-auto relative z-30 flex w-full justify-center-safe overflow-x-auto! overflow-y-hidden",
          // touch-pan-y (NOT pan-x): horizontal touchmoves stay cancelable and are delivered to the
          // JS handler below, while vertical still scrolls the page natively. NO scroll-smooth / snap:
          // they make programmatic scrollLeft animate, so per-touchmove assignments never track the finger.
          "touch-pan-y overscroll-x-contain",
          "px-2 md:px-0",
          "[&::-webkit-scrollbar]:hidden",
          "[scrollbar-width:none]",
          "[-webkit-overflow-scrolling:touch]",
        )}
      >
        <AnimatedToggleGroup
          items={items}
          value={currentValue}
          onValueChange={handleValueChange}
          size={isMobile ? "compact" : "sm"}
          variant="default"
          // flex-none: keep the group at content width so the OUTER scroll div (above) is the
          // element that overflows and scrolls. Without it the group (it has its own overflow-x-auto)
          // shrinks to fit and scrolls internally, so scrollRef.scrollLeft would be a no-op.
          className="pointer-events-auto bg-transparent flex-none"
        />
      </div>
    </div>
  );
};

/** Helper to get interval data for a given code - use to derive range/description from a code */
const getInitialIntervalData = (code: TimePeriod = DEFAULT_INTERVAL_CODE) => {
  const data = getIntervalData(code);
  return {
    code: data.code,
    description: data.description,
    range: data.calculateRange(),
  };
};

export { IntervalSelector, getInitialIntervalData };
