import { calculatePerformanceSummary } from "@/adapters";
import { ChartRangePicker } from "@/components/chart-range-picker";
import { HistoryChart } from "@/components/history-chart";
import { useHapticFeedback } from "@/hooks";
import { useCurrentValuation } from "@/hooks/use-current-account-valuations";
import { useHoldings } from "@/hooks/use-holdings";
import { useValuationHistory } from "@/hooks/use-valuation-history";
import { HoldingType, isAlternativeAssetKind } from "@/lib/constants";
import { performanceSummaryReturn, performancePeriodPnl } from "@/lib/performance";
import { QueryKeys } from "@/lib/query-keys";
import { useSettingsContext } from "@/lib/settings-provider";
import { DateRange, TimePeriod } from "@/lib/types";
import { PortfolioUpdateTrigger } from "@/pages/dashboard/portfolio-update-trigger";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { TimePeriod as UITimePeriod } from "@wealthfolio/ui";
import {
  GainAmount,
  GainPercent,
  getInitialIntervalData,
  IntervalSelector,
  usePersistentState,
} from "@wealthfolio/ui";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { AccountsSummary } from "./accounts-summary";
import Balance from "./balance";
import SavingGoals from "./goals";
import TopHoldings from "./top-holdings";

const DEFAULT_INTERVAL: UITimePeriod = "3M";
const INTERVAL_STORAGE_KEY = "dashboard-interval";

function getDashboardChartMinDomainSpanRatio(period: UITimePeriod): number {
  switch (period) {
    case "1D":
    case "1W":
      return 0.035;
    case "1M":
    case "3M":
      return 0.08;
    case "6M":
    case "YTD":
    case "1Y":
      return 0.16;
    case "5Y":
    case "ALL":
      return 0.2;
    default:
      return 0.12;
  }
}

function getDashboardNetContributionMaxDomainSpanRatio(period: UITimePeriod): number | undefined {
  switch (period) {
    case "1D":
    case "1W":
      return undefined;
    case "1M":
    case "3M":
      return 1.4;
    case "6M":
    case "YTD":
    case "1Y":
      return 2.2;
    case "5Y":
    case "ALL":
      return 2.8;
    default:
      return 1.8;
  }
}

export function DashboardContent() {
  // Use the same persisted state as IntervalSelector for the interval code
  const [intervalCode] = usePersistentState<UITimePeriod>(INTERVAL_STORAGE_KEY, DEFAULT_INTERVAL);

  // Derive initial values from the persisted interval code
  const [dateRange, setDateRange] = useState<DateRange | undefined>(
    () => getInitialIntervalData(intervalCode).range,
  );
  const [selectedIntervalDescription, setSelectedIntervalDescription] = useState<string>(
    () => getInitialIntervalData(intervalCode).description,
  );
  const [selectedInterval, setSelectedInterval] = useState<UITimePeriod>(() => intervalCode);
  const [isAllTime, setIsAllTime] = useState<boolean>(() => intervalCode === "ALL");
  const [brushDisplayRange, setBrushDisplayRange] = useState<DateRange | undefined>(undefined);

  const { holdings: allHoldings, isLoading: isHoldingsLoading } = useHoldings({ type: "all" });
  const {
    currentValuation: portfolioCurrentValuation,
    isLoading: isCurrentValuationLoading,
    error: currentValuationError,
  } = useCurrentValuation({ type: "all" }, { includeAccounts: true });
  const { triggerHaptic } = useHapticFeedback();

  // Filter holdings for display (exclude alternative assets and cash for TopHoldings)
  const holdings = useMemo(() => {
    if (!allHoldings) return [];
    return allHoldings.filter((h) => {
      // Exclude cash holdings from display
      if (h.holdingType === HoldingType.CASH) return false;
      // Exclude alternative assets from display
      if (h.assetKind && isAlternativeAssetKind(h.assetKind)) return false;
      return true;
    });
  }, [allHoldings]);

  const totalValue = portfolioCurrentValuation?.summary.totalValueBase ?? 0;

  const valuationHistoryRange = isAllTime ? undefined : dateRange;
  const { valuationHistory, isLoading: isValuationHistoryLoading } =
    useValuationHistory(valuationHistoryRange);

  const { settings } = useSettingsContext();
  const baseCurrency = settings?.baseCurrency ?? "USD";

  // When a brush selection is active, use the brushed window for the performance
  // summary so the gain/loss numbers reflect what's visible in the chart.
  // valuationHistoryRange (chart data fetch) is unaffected — brush stays client-side.
  const perfFrom = brushDisplayRange?.from ?? (!isAllTime ? dateRange?.from : undefined);
  const perfTo = brushDisplayRange?.to ?? (!isAllTime ? dateRange?.to : undefined);
  const startDate = perfFrom ? format(perfFrom, "yyyy-MM-dd") : undefined;
  const endDate = perfTo ? format(perfTo, "yyyy-MM-dd") : undefined;
  const datesReady = (isAllTime && !brushDisplayRange) || (!!startDate && !!endDate);

  const { data: portfolioPerformance, isLoading: isPortfolioPerformanceLoading } = useQuery({
    queryKey: [QueryKeys.PERFORMANCE_SUMMARY, "dashboard", "all", startDate, endDate],
    queryFn: () =>
      calculatePerformanceSummary({
        itemType: "account",
        itemId: "portfolio:all",
        startDate,
        endDate,
        filter: { type: "all" },
        profile: "dashboard",
      }),
    enabled: datesReady,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    retry: 1,
  });

  const gainLossAmount = performancePeriodPnl(portfolioPerformance);
  const simpleReturn = performanceSummaryReturn(portfolioPerformance);
  const isCurrentValuationUnavailable =
    !isCurrentValuationLoading && !portfolioCurrentValuation && Boolean(currentValuationError);
  const portfolioSourceDataAsOf =
    portfolioCurrentValuation?.summary.sourceDataAsOf ??
    (!isCurrentValuationUnavailable
      ? valuationHistory?.[valuationHistory.length - 1]?.calculatedAt
      : undefined);

  const chartData = useMemo(() => {
    return (
      valuationHistory?.map((item) => ({
        date: item.valuationDate,
        totalValue: item.totalValueBase,
        netContribution: item.netContributionBase,
        currency: item.baseCurrency ?? baseCurrency,
      })) ?? []
    );
  }, [valuationHistory, baseCurrency]);

  // The "ALL" preset uses 1970-01-01 as a sentinel "from" date, which is confusing to see
  // pre-filled in the calendar. Clamp the picker's *displayed* from up to the first date that
  // actually has portfolio data. Display-only: this does not change what useValuationHistory fetches.
  const firstDataDate = chartData[0]?.date;
  const pickerValue = useMemo<DateRange | undefined>(() => {
    if (!dateRange?.from || !firstDataDate) {
      return dateRange;
    }
    const earliest = new Date(firstDataDate);
    return dateRange.from < earliest ? { from: earliest, to: dateRange.to } : dateRange;
  }, [dateRange, firstDataDate]);

  const chartMinDomainSpanRatio = useMemo(
    () => getDashboardChartMinDomainSpanRatio(selectedInterval),
    [selectedInterval],
  );
  const chartNetContributionMaxDomainSpanRatio = useMemo(
    () => getDashboardNetContributionMaxDomainSpanRatio(selectedInterval),
    [selectedInterval],
  );

  const isNegative = totalValue < 0;

  // Callback for IntervalSelector
  const handleIntervalSelect = (
    code: TimePeriod,
    description: string,
    range: DateRange | undefined,
  ) => {
    setSelectedInterval(code);
    setSelectedIntervalDescription(description);
    setDateRange(range);
    setIsAllTime(code === "ALL");
    setBrushDisplayRange(undefined);
  };

  // Callback for the custom date range picker (sets the same dateRange the
  // period buttons use, so the existing useValuationHistory hook refetches it).
  const handleCustomRangeChange = (range: { from?: Date; to?: Date } | undefined) => {
    setDateRange({ from: range?.from, to: range?.to });
    setIsAllTime(false);
    setBrushDisplayRange(undefined);
    if (range?.from && range?.to) {
      setSelectedIntervalDescription(
        `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`,
      );
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pb-1 pt-2 md:px-6 lg:px-8">
        <PortfolioUpdateTrigger
          lastCalculatedAt={portfolioSourceDataAsOf}
          notices={portfolioCurrentValuation?.summary.warnings}
        >
          <div className="flex items-start gap-2">
            <div>
              <Balance
                isLoading={isCurrentValuationLoading}
                isUnavailable={isCurrentValuationUnavailable}
                targetValue={totalValue}
                currency={baseCurrency}
                displayCurrency={true}
              />
              <div className="text-md flex min-h-5 items-center space-x-3">
                {isPortfolioPerformanceLoading ? (
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-24" />
                    <div className="border-secondary my-1 border-r pr-2" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ) : (
                  <>
                    {gainLossAmount == null ? (
                      <span className="text-muted-foreground lg:text-md text-sm font-light">
                        N/A
                      </span>
                    ) : (
                      <GainAmount
                        className="lg:text-md text-sm font-light"
                        value={gainLossAmount}
                        currency={baseCurrency}
                        displayCurrency={false}
                      />
                    )}
                    <div className="border-secondary my-1 border-r pr-2" />
                    {simpleReturn == null ? (
                      <span className="text-muted-foreground lg:text-md text-sm font-light">
                        N/A
                      </span>
                    ) : (
                      <GainPercent
                        className="lg:text-md text-sm font-light"
                        value={simpleReturn}
                        animated={true}
                      />
                    )}
                  </>
                )}
                {(selectedIntervalDescription || brushDisplayRange) && (
                  <span className="lg:text-md text-muted-foreground ml-1 text-sm font-light">
                    {brushDisplayRange?.from && brushDisplayRange?.to
                      ? `${format(brushDisplayRange.from, "MMM d, yyyy")} – ${format(brushDisplayRange.to, "MMM d, yyyy")}`
                      : selectedIntervalDescription}
                  </span>
                )}
              </div>
            </div>
          </div>
        </PortfolioUpdateTrigger>
      </div>

      <div
        className={`bg-linear-to-t flex grow flex-col ${
          isNegative
            ? "from-destructive/30 via-destructive/15 to-transparent"
            : "from-success/30 via-success/15 to-transparent"
        }`}
      >
        <div className="h-[320px]">
          <HistoryChart
            data={chartData}
            isLoading={isValuationHistoryLoading}
            scaleMode="fit-visible"
            minDomainSpanRatio={chartMinDomainSpanRatio}
            netContributionMaxDomainSpanRatio={chartNetContributionMaxDomainSpanRatio}
            onVisibleRangeChange={(r) =>
              setBrushDisplayRange(r ? { from: new Date(r.from), to: new Date(r.to) } : undefined)
            }
          />
          {valuationHistory && chartData.length > 0 && (
            <div className="flex w-full -translate-y-6 items-center justify-center gap-2 px-4">
              <IntervalSelector
                className="pointer-events-auto relative z-20 w-auto max-w-full"
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
              />
            </div>
          )}
        </div>

        <div className="grow px-4 pb-[var(--mobile-nav-total-offset)] pt-12 md:px-6 md:pb-6 md:pt-6 lg:px-10 lg:pb-8 lg:pt-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-20">
            <div className="lg:col-span-2">
              <AccountsSummary
                dateRange={dateRange}
                isAllTime={isAllTime}
                currentAccountValuations={portfolioCurrentValuation?.accounts}
                isLoadingCurrentValuations={isCurrentValuationLoading}
              />
            </div>
            <div className="space-y-6 lg:col-span-1">
              <TopHoldings
                holdings={holdings}
                isLoading={isHoldingsLoading}
                baseCurrency={baseCurrency}
              />
              <SavingGoals />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardContent;
