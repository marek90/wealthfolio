import type { DateRange } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Calendar } from "@wealthfolio/ui/components/ui/calendar";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import { useIsMobile } from "@wealthfolio/ui";
import type { DateRange as DayPickerDateRange } from "react-day-picker";
import { useState } from "react";

interface ChartRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  /** When true, the trigger shows the same white "bubble" highlight the period pills use,
   *  signalling that a custom calendar range is the active selection. */
  isActive?: boolean;
  className?: string;
}

/**
 * Compact calendar-icon "bubble" date-range picker for the portfolio history chart.
 * Mirrors the trigger design used by DateRangeSelector on Insights → Performance so the
 * control sits inline (single line) next to the IntervalSelector period pills, instead of
 * the wide DatePickerWithRange button. Icon-only on purpose — the selected range shows
 * inside the calendar popover.
 */
export function ChartRangePicker({ value, onChange, isActive, className }: ChartRangePickerProps) {
  const isMobile = useIsMobile();
  // Selection in progress lives here, NOT in the parent: react-day-picker fires
  // onSelect with {from, to: undefined} on the first tap of a range, and committing
  // that to the parent triggers a refetch for a degenerate range. Only a complete
  // range is handed to onChange.
  const [draft, setDraft] = useState<DayPickerDateRange | undefined>(undefined);

  const selected = draft ?? (value as DayPickerDateRange | undefined);

  return (
    <Popover
      onOpenChange={() => {
        // Opening or closing discards any half-picked range; reseed from `value`.
        setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-9 rounded-full p-0",
            isActive && "bg-background text-foreground shadow-sm",
            className,
          )}
          aria-label="Choose custom date range"
        >
          <Icons.Calendar className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[min(var(--radix-popover-content-available-height,80vh),80vh)] w-auto overflow-y-auto overscroll-contain p-0 [-webkit-overflow-scrolling:touch]"
        align="center"
      >
        <Calendar
          mode="range"
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={(range: DayPickerDateRange | undefined) => {
            setDraft(range);
            if (range?.from && range?.to) {
              onChange(range as DateRange);
            }
          }}
          numberOfMonths={isMobile ? 1 : 3}
        />
      </PopoverContent>
    </Popover>
  );
}
