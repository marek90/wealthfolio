import { expect, Page, test } from "@playwright/test";
import {
  completeOnboardingIfNeeded,
  createAccount,
  fillDateField,
  gotoActivities,
  gotoAppPath,
  openAddActivitySheet,
  selectAccountOption,
  selectActivityType,
} from "./helpers";

/**
 * Custom-fork spec: the dashboard history-chart calendar range picker
 * (apps/frontend/src/components/chart-range-picker.tsx).
 *
 * Guards the two mobile bugs fixed in July 2026:
 *  1. numberOfMonths must be 1 on mobile (3 stacked months overflowed the viewport)
 *  2. tapping only a "from" date must NOT commit a half-open range — doing so used
 *     to blank the chart and unmount the period pills, the picker and the popover.
 */

const CALENDAR_TRIGGER = "chart-range-picker-trigger";

async function seedPortfolio(page: Page) {
  await completeOnboardingIfNeeded(page);
  await createAccount(page, "Calendar E2E", "CAD");

  await gotoActivities(page);
  for (const daysAgo of [40, 20]) {
    await openAddActivitySheet(page);
    await selectActivityType(page, "Deposit");
    await selectAccountOption(page, "Calendar E2E", "CAD");
    await fillDateField(page, daysAgo);
    const amountInput = page.getByTestId("amount-input");
    await amountInput.fill("2500");
    await amountInput.blur();
    await page.waitForTimeout(200);
    const submitButton = page.getByRole("button", { name: /Add Deposit/i });
    await expect(submitButton).toBeEnabled({ timeout: 5000 });
    await submitButton.click();
    await expect(page.getByTestId("activity-form-dialog")).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(500);
  }
}

async function openDashboardCalendar(page: Page) {
  await gotoAppPath(page, "/");
  const trigger = page.getByTestId(CALENDAR_TRIGGER).first();
  await expect(trigger).toBeVisible({ timeout: 30000 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByRole("grid").first()).toBeVisible({ timeout: 10000 });
  return trigger;
}

/** Click (or tap, on touch viewports) a day-of-month button inside the (first) visible month grid. */
async function clickDay(page: Page, day: number, opts: { tap?: boolean } = {}) {
  const dayButton = page.getByRole("grid").first().getByText(String(day), { exact: true }).first();
  if (opts.tap) {
    await dayButton.tap();
  } else {
    await dayButton.click();
  }
}

test.describe.configure({ mode: "serial" });

test.describe("Chart calendar range picker", () => {
  test("setup: onboard and seed deposits", async ({ page }) => {
    test.setTimeout(180000);
    await seedPortfolio(page);
  });

  test("desktop: shows 3 months; partial selection never unmounts the chart UI", async ({
    page,
  }) => {
    const trigger = await openDashboardCalendar(page);

    // Desktop (>=768px viewport) renders three month grids.
    await expect(page.getByRole("grid")).toHaveCount(3);

    // Tap only a "from" date: the popover must stay open and nothing may unmount.
    await clickDay(page, 10);
    await expect(page.getByRole("grid").first()).toBeVisible();
    await expect(trigger).toBeVisible();
    await expect(page.locator(".history-brush").first()).toBeVisible();

    // Complete the range: picker becomes the active control (white-bubble highlight).
    await clickDay(page, 15);
    await expect(trigger).toHaveClass(/bg-background/, { timeout: 10000 });
    // Chart and pills survive the refetch.
    await expect(page.locator(".history-brush").first()).toBeVisible();
    await expect(trigger).toBeVisible();
  });

  test.describe("mobile viewport", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test("bottom sheet: single month, touch month-nav works, Done commits the range", async ({
      page,
    }) => {
      // Open via TAP, not click — the July 2026 regression (dead month-nav buttons on
      // iOS) only reproduces through the touch event path.
      await gotoAppPath(page, "/");
      const trigger = page.getByTestId(CALENDAR_TRIGGER).first();
      await expect(trigger).toBeVisible({ timeout: 30000 });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.tap();
      await expect(page.getByRole("grid").first()).toBeVisible({ timeout: 10000 });

      // One month grid only — three stacked months overflowed a phone screen.
      await expect(page.getByRole("grid")).toHaveCount(1);

      // Month navigation must be available and must respond to TOUCH.
      const nextButton = page.locator(".rdp-button_next, [aria-label*='next month' i]").first();
      const prevButton = page
        .locator(".rdp-button_previous, [aria-label*='previous month' i]")
        .first();
      await expect(nextButton).toBeVisible();
      await expect(prevButton).toBeVisible();

      const caption = page.locator("[class*='month_caption']").first();
      const monthBefore = await caption.textContent();
      await prevButton.tap();
      await expect(caption).not.toHaveText(monthBefore ?? "", { timeout: 5000 });

      const calendarRoot = page.locator(".rdp-root").first();
      const box = await calendarRoot.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(390);

      // Select a full range by touch; nothing commits until Done is tapped.
      await clickDay(page, 5, { tap: true });
      await expect(page.getByRole("grid").first()).toBeVisible();
      await clickDay(page, 12, { tap: true });
      await expect(trigger).not.toHaveClass(/bg-background/);

      const applyButton = page.getByTestId("chart-range-picker-apply");
      await expect(applyButton).toBeEnabled();
      await applyButton.tap();

      // Sheet closes, the picker becomes the active control, chart UI stays mounted.
      await expect(page.getByRole("grid")).toHaveCount(0);
      await expect(trigger).toHaveClass(/bg-background/, { timeout: 10000 });
      await expect(page.locator(".history-brush").first()).toBeVisible();
      await expect(trigger).toBeVisible();
    });
  });
});
