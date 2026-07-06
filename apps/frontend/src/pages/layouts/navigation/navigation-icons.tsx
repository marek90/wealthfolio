import { Icons } from "@wealthfolio/ui/components/ui/icons";
import React from "react";

// Semantic aliases layered on top of the full host icon barrel: these map
// friendly/legacy names to a chosen icon (e.g. "chart" -> Insight, "trading" ->
// TrendingUp) where the name doesn't match a barrel key directly. Any name that
// isn't listed here falls through to the barrel index below, so addons can use
// any icon the host bundles.
const addonIconMap = {
  addon: Icons.Addons,
  addons: Icons.Addons,
  barchart: Icons.BarChart,
  blocks: Icons.Blocks,
  calendar: Icons.Calendar,
  calendardots: Icons.CalendarDots,
  calendardays: Icons.Calendar,
  calendaricon: Icons.CalendarIcon,
  chart: Icons.Insight,
  chartbar: Icons.ChartBar,
  chartline: Icons.TrendingUp,
  dashboard: Icons.Dashboard,
  fee: Icons.Invoice,
  fees: Icons.Invoice,
  goal: Icons.Goal,
  goals: Icons.Goals,
  holdings: Icons.Holdings,
  invoice: Icons.Invoice,
  puzzle: Icons.PuzzlePiece,
  puzzlepiece: Icons.PuzzlePiece,
  receipt: Icons.ReceiptDuotone,
  receipttext: Icons.ReceiptText,
  settings: Icons.Settings,
  target: Icons.Target,
  trading: Icons.TrendingUp,
  trendingup: Icons.TrendingUp,
  wallet: Icons.Wallet,
} satisfies Record<string, React.ComponentType<{ className?: string }>>;

function normalizeIconKey(icon: string) {
  return icon.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Every icon in the host `@wealthfolio/ui` barrel, keyed by its normalized name.
// Built once at module load; these components are already bundled by the app, so
// exposing all of them to addons costs no extra bundle size. Matching is
// case/separator-insensitive (e.g. "trending-up", "TrendingUp", "trendingup").
const barrelIconIndex: Record<
  string,
  React.ComponentType<{ className?: string }>
> = Object.fromEntries(
  Object.entries(Icons).map(([name, Component]) => [
    normalizeIconKey(name),
    Component as React.ComponentType<{ className?: string }>,
  ]),
);

export function resolveNavigationIcon(icon: React.ReactNode, className: string) {
  if (!icon) {
    return <Icons.PuzzlePiece className={className} />;
  }

  if (typeof icon === "string") {
    const key = normalizeIconKey(icon);
    const IconComponent = addonIconMap[key as keyof typeof addonIconMap] ?? barrelIconIndex[key];
    return IconComponent ? (
      <IconComponent className={className} />
    ) : (
      <Icons.PuzzlePiece className={className} />
    );
  }

  if (React.isValidElement<{ className?: string }>(icon)) {
    return icon.props.className ? icon : React.cloneElement(icon, { className });
  }

  if (typeof icon === "function") {
    const IconComponent = icon as React.ComponentType<{ className?: string }>;
    return <IconComponent className={className} />;
  }

  return <Icons.PuzzlePiece className={className} />;
}
