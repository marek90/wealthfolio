import type { DateRange } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Calendar } from "@wealthfolio/ui/components/ui/calendar";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import type { DateRange as DayPickerDateRange } from "react-day-picker";

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
  return (
    <Popover>
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
      <PopoverContent className="w-auto p-0" align="center">
        <Calendar
          mode="range"
          defaultMonth={value?.from}
          selected={value as DayPickerDateRange | undefined}
          onSelect={(range: DayPickerDateRange | undefined) => onChange(range as DateRange | undefined)}
          numberOfMonths={3}
        />
      </PopoverContent>
    </Popover>
  );
}
