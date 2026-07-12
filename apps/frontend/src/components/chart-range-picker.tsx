import type { DateRange } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Calendar } from "@wealthfolio/ui/components/ui/calendar";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@wealthfolio/ui/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@wealthfolio/ui/components/ui/sheet";
import { useIsMobile } from "@wealthfolio/ui";
import type { DateRange as DayPickerDateRange } from "react-day-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
 * Mirrors DateRangeSelector (packages/ui): a Popover with 3 months on desktop, and a
 * bottom Sheet with a single month + explicit Done on mobile. The Sheet is not just a
 * style choice — on iOS Safari the calendar's absolutely-positioned month-nav buttons
 * don't receive taps inside a Popover, so mobile must not use one (same reason upstream's
 * DateRangeSelector splits by useIsMobile). Icon-only on purpose — the selected range
 * shows inside the picker itself.
 */
export function ChartRangePicker({ value, onChange, isActive, className }: ChartRangePickerProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // Selection in progress lives here, NOT in the parent: react-day-picker fires
  // onSelect with {from, to: undefined} on the first tap of a range, and committing
  // that to the parent triggers a refetch for a degenerate range. Only a complete
  // range is handed to onChange.
  const [draft, setDraft] = useState<DayPickerDateRange | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isDraftComplete = !!draft?.from && !!draft?.to;

  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 w-9 rounded-full p-0",
        isActive && "bg-background text-foreground shadow-sm",
        className,
      )}
      aria-label={t("ui:dateRange.chooseCustom", "Choose custom date range")}
      data-testid="chart-range-picker-trigger"
    >
      <Icons.Calendar className="h-4 w-4" />
    </Button>
  );

  if (isMobile) {
    return (
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          // Opening seeds the draft from the applied value; closing discards it.
          setDraft(open ? (value as DayPickerDateRange | undefined) : undefined);
          setSheetOpen(open);
        }}
      >
        <SheetTrigger asChild>{triggerButton}</SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-4xl mx-1 flex max-h-[85vh] flex-col p-0">
          <SheetHeader className="border-border border-b px-6 py-4">
            <SheetTitle>{t("ui:dateRange.customRange", "Custom range")}</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="border-border/70 bg-muted/30 rounded-lg border px-3 py-2">
                <div className="text-muted-foreground text-xs font-medium">
                  {t("ui:dateRange.start", "Start")}
                </div>
                <div className="text-foreground mt-1 truncate text-sm font-medium">
                  {draft?.from ? formatDate(draft.from) : t("ui:dateRange.notSet", "Not set")}
                </div>
              </div>
              <div className="border-border/70 bg-muted/30 rounded-lg border px-3 py-2">
                <div className="text-muted-foreground text-xs font-medium">
                  {t("ui:dateRange.end", "End")}
                </div>
                <div className="text-foreground mt-1 truncate text-sm font-medium">
                  {draft?.to ? formatDate(draft.to) : t("ui:dateRange.notSet", "Not set")}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-center">
              <Calendar
                mode="range"
                defaultMonth={draft?.from}
                selected={draft}
                onSelect={(range: DayPickerDateRange | undefined) => setDraft(range)}
                numberOfMonths={1}
                className="p-0 [--cell-size:2.5rem]"
              />
            </div>
          </div>

          <SheetFooter className="border-border flex-row gap-2 border-t px-6 py-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setDraft(undefined)}
              disabled={!draft}
              data-testid="chart-range-picker-clear"
            >
              {t("ui:dateRange.clear", "Clear")}
            </Button>
            <Button
              type="button"
              className="ml-auto"
              onClick={() => {
                if (!isDraftComplete) return;
                onChange(draft as DateRange);
                setDraft(undefined);
                setSheetOpen(false);
              }}
              disabled={!isDraftComplete}
              data-testid="chart-range-picker-apply"
            >
              {t("ui:dateRange.done", "Done")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  const selected = draft ?? (value as DayPickerDateRange | undefined);

  return (
    <Popover
      onOpenChange={() => {
        // Opening or closing discards any half-picked range; reseed from `value`.
        setDraft(undefined);
      }}
    >
      <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
      <PopoverContent
        className="max-h-[min(var(--radix-popover-content-available-height,80vh),80vh)] w-auto overflow-y-auto overscroll-contain p-0"
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
          numberOfMonths={3}
        />
      </PopoverContent>
    </Popover>
  );
}
