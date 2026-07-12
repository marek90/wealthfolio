# Wealthfolio Upstream Upgrade — Reusable Prompt

Copy everything below the line into a fresh Claude Code session (started in this
repo) whenever upstream releases a new version. Replace `X.Y.Z` with the new
version number. Written 2026-07-05 after the v3.6.0 upgrade.

To make the app accessible from an iPhone / other devices on the network, on the macOS host run: 

```
socat TCP-LISTEN:8899,fork,reuseaddr TCP:192.168.64.6:8899
```

and then you can access it over at `http://192.168.0.90:8899/`. 

---

Wealthfolio X.Y.Z has been released upstream. Completely and autonomously (I am
away from the computer) upgrade our custom web app to X.Y.Z, carrying over all
our modifications. Follow every directive below — they encode hard-won lessons
from previous upgrades.

## What this fork is

- Fork: `marek90/wealthfolio` (remote `origin`), upstream: `wealthfolio/wealthfolio`
  (remote `upstream`). Work happens directly on `main`.
- **`CUSTOM_CHANGES.md` in the repo root is the authoritative map of every custom
  modification.** Read it fully before touching anything. Keep it updated as part
  of the upgrade — it exists so that sessions like yours can reconstruct intent.
- Custom surface (verify against CUSTOM_CHANGES.md, it may have grown):
  chart-range-picker.tsx (ours entirely), history-chart.tsx (brush/drag zoom),
  dashboard-content.tsx, account-page.tsx, globals.css (pill suppressor + brush
  rounding), packages/ui interval-selector.tsx (mobile touch-scroll — the only
  allowed packages/ui edit), compose.yml, e2e/90-chart-calendar.spec.ts.
- Deploy: Docker via `compose.yml` — image `wealthfolio-custom`, container
  `wealthfolio-custom`, host port 8899, env from `secrets/.env.compose`
  (gitignored — NEVER commit `secrets/` or `data/`). MCP is enabled via
  `WF_MCP_ENABLED=true` in that env file.

## Host constraints (do not rediscover these the hard way)

- **No GitHub credentials on this host** (no token, no SSH key, no helper, no gh
  CLI). Do all git work locally; ask me to run the final
  `git push origin main <backup-branch>` via the notification. Don't retry push
  variants.
- **No Rust toolchain and no Google Chrome on this host.** `pnpm test:e2e` /
  `pnpm run dev:web` cannot run. Run E2E against a disposable container instead
  (recipe below). System browser is `/usr/bin/chromium`.
- 4 cores / 3.8 GB RAM. Don't run the Docker build and Playwright concurrently.
- Docker build: Rust layers dominate (~10 min cold); frontend-only changes
  rebuild in seconds thanks to layer cache.

## Procedure

Plan first (analyze before editing), then execute:

1. **Analyze impact before merging.** Fetch upstream tags. Diff the upstream base
   → new tag for every file CUSTOM_CHANGES.md lists as modified (GitHub compare
   API or `git diff <merge-base> <tag> -- <files>`). Report-to-self: which of our
   files upstream touched and how. If the upgrade looks structurally incompatible
   with a custom feature, stop and notify me instead of improvising.
2. **Safety net:** create branch `backup/pre-vX.Y.Z` at current `main` (push is
   blocked — I'll push it; still create it locally).
3. **Merge** the release tag into `main`. Conflict policy: adopt upstream's
   version as the base, re-apply our additions per CUSTOM_CHANGES.md. After
   resolving, grep for leftover conflict markers AND for our fingerprints
   (`Brush`, `ReferenceArea`, `onVisibleRangeChange`, `interval-pill-suppressed`,
   `scrollRef`, `chart-range-picker`) to prove both sides survived. Watch for
   upstream deleting state/props our code references — auto-merge won't flag
   that; the type-check will.
4. **Gates:** `pnpm install`, `pnpm type-check`, `pnpm test`. All green before
   proceeding.
5. **Conventions for any code we add or fix during the upgrade:**
   - User-facing strings: `t()` with an upstream key if one exists (check
     `apps/frontend/src/i18n/locales/en/*.json` first), else a new key with an
     English fallback default. Translate aria-labels too — upstream does.
   - Visible dates: the shared `formatDate()` from `@/lib/utils`, never inline
     `format(d, "MMM d, yyyy")`.
   - E2E selectors: `data-testid`, never English text.
   - Dashboard chart controls must never be unmounted when `chartData` is empty
     (recovery path), and only complete date ranges may reach `setDateRange`.
   - Account page clips at the Card border — re-check its chart layout
     separately from the dashboard (CUSTOM_CHANGES.md §5.12).
   - Mobile calendar UIs live in a bottom Sheet, never a Popover — iOS Safari
     drops taps on the calendar's absolutely-positioned month-nav inside a
     Popover, and never add `[-webkit-overflow-scrolling:touch]` to a scroll
     container with absolutely-positioned children (CUSTOM_CHANGES.md §5.14).
     Chromium/Playwright cannot reproduce this bug — mobile-touch changes need
     a real-device check; keep the mobile e2e driving via `tap()`, not `click()`.
6. **Docker rebuild + swap:**
   - `docker compose build` (background it; log to a file).
   - `docker compose down`, then back up the DB **before** the new version's
     migrations run (they are one-way):
     `cp -a data/wealthfolio.db data/wealthfolio.db.pre-vX.Y.Z.bak`
   - `docker compose up -d`; verify `docker ps` shows healthy,
     `curl -fsS http://localhost:8899/api/v1/healthz` returns ok,
     `curl -s -o /dev/null -w '%{http_code}' http://localhost:8899/mcp` returns
     401 (MCP mounted + auth-gated), and logs have no errors. The startup WARN
     `Unknown provider ID: CUSTOM_SCRAPER` is pre-existing and benign.
7. **E2E verification** (container recipe — the only way on this host):
   ```bash
   docker run -d --name wf-e2e-test -p 8898:8088 \
     -e WF_LISTEN_ADDR=0.0.0.0:8088 -e WF_DB_PATH=/data/e2e.db \
     -e WF_SECRET_KEY="$(openssl rand -base64 32)" \
     -e WF_AUTH_REQUIRED=false \
     -e WF_CORS_ALLOW_ORIGINS=http://localhost:8898 \
     --tmpfs /data:size=256M,uid=1000,gid=1000,mode=0770 \
     wealthfolio-custom
   ```
   (tmpfs MUST carry `uid=1000` — the app runs non-root.) Wait for healthz on
   8898, then run our regression spec with a Playwright config that sets
   `launchOptions.executablePath: "/usr/bin/chromium"` and
   `WF_E2E_BASE_URL=http://localhost:8898`:
   `npx playwright test 90-chart-calendar --config=<custom config>`.
   It must pass 3/3 (it self-seeds; covers the calendar picker on desktop and
   mobile viewports). Remove the test container afterwards. Optionally grab a
   390px-viewport screenshot of the open calendar as visual proof.
8. **Update CUSTOM_CHANGES.md**: merge notes (conflicts + resolutions), any new
   lessons, bump the "Last updated" footer. Commit everything with clear
   messages; leave the working tree clean.
9. **Export the image** for transfer to the other server (check `df -h` first;
   needs ~150 MB): `docker save wealthfolio-custom:latest | gzip >
   wealthfolio-custom-vX.Y.Z.tar.gz` in the repo root (it stays untracked).
   If anything changes the image after export (even env-only fixes rebuild), re-export.
10. **Report** via Pushover (always priority -1):
    ```bash
    curl -s -X POST https://pushover.tomasovic.cloud/ \
      -H "Authorization: Bearer claude_zuB8433oKJ" \
      -F "title=Claude Code" -F "priority=-1" \
      -F "message=<summary: merge result, conflicts, test results, health, tarball path, DB backup path, and the git push command I need to run>"
    ```
    Also use it any time you're blocked on something only I can do.

## Rollback path (include in the report)

`git reset --hard backup/pre-vX.Y.Z` + restore `data/wealthfolio.db.pre-vX.Y.Z.bak`
+ rebuild the image.
