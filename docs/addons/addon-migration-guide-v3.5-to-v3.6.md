# Migration Guide: Wealthfolio Addons v3.5 to v3.6

Wealthfolio 3.6 runs every addon inside an **isolated sandbox iframe**
(`sandbox="allow-scripts"`, opaque origin) instead of in the main app runtime.
The iframe boundary cannot pass live functions or React elements across it, so
the way addons register routes, access React, and bundle shared libraries all
changed. **Every addon that renders a route must be updated** — a 3.5-era addon
will not render in 3.6.

> If you are still on the v2 → v3 SDK, do that migration first (see
> [addon-migration-guide-v2-to-v3.md](./addon-migration-guide-v2-to-v3.md)),
> then follow this guide.

## Overview

| Aspect             | v3.5 (main-runtime)                          | v3.6 (sandboxed iframe)                            |
| ------------------ | -------------------------------------------- | -------------------------------------------------- |
| Execution          | Runs in the host app's React tree            | Runs in an isolated iframe, opaque origin          |
| Route registration | `component: React.lazy(...)`                 | `render: (ctx) => {...}` into `ctx.root`           |
| React access       | `import { React, ReactDOM } from sdk`        | `import { createRoot } from 'react-dom/client'`    |
| Shared libs        | Bundled or global-mapped (`ReactDOM` global) | ESM `external`, provided by the sandbox at runtime |
| Sidebar icon       | `string \| React.ReactNode`                  | `string` only (host icon name)                     |
| Sidebar onClick    | `onClick: () => void`                        | Removed — use `route`                              |
| React version      | 19.1.1                                       | 19.2.4                                             |
| Manifest           | `sdkVersion`                                 | + `minWealthfolioVersion`, `hostDependencies`      |

---

## 1. Route registration: `component` → `render`

This is the breaking change that affects every addon. The host can no longer
receive a lazy React component and mount it in its own tree — the addon renders
itself into a DOM node the sandbox hands it.

**Before (v3.5):**

```tsx
ctx.router.add({
  path: "/addon/my-addon",
  component: React.lazy(() => import("./pages/MainPage")),
});
```

**After (v3.6):**

```tsx
import { createRoot, type Root } from "react-dom/client";
import { MainPage } from "./pages/MainPage";

export default function enable(ctx: AddonContext) {
  let root: Root | null = null;

  ctx.router.add({
    path: "/addon/my-addon",
    render: ({ root: routeRoot }) => {
      root ??= createRoot(routeRoot);
      root.render(<MainPage ctx={ctx} />);
    },
  });

  ctx.onDisable(() => {
    root?.unmount();
    root = null;
  });
}
```

Notes:

- `render` receives `{ root, location }` (`AddonRouteRenderContext`). `root` is
  the `HTMLElement` to mount into; `location` is
  `{ pathname, search, hash, params }` (`AddonRouteLocation`) for reading route
  params.
- Create the React root **once** and reuse it across renders (`root ??=`), then
  `unmount()` in `onDisable`. Calling `createRoot` on every render leaks.
- `RouteConfig` also gained optional `id` (stable route id) and `title` (used
  for diagnostics).

---

## 2. React is no longer an SDK export

The SDK used to re-export the host's React via `window` globals. Those exports
(`React`, `ReactDOM`) are **removed**. Import React normally — your bundle marks
it `external` (step 4) and the sandbox provides the real instance at runtime, so
you still share one React with the host.

**Before:**

```tsx
import { React, ReactDOM } from "@wealthfolio/addon-sdk";
```

**After:**

```tsx
import { createRoot } from "react-dom/client";
// hooks/JSX: import from 'react' as usual
```

`ReactVersion` is still exported (now `19.2.4`) if you need to assert a version
at runtime. The new `HOST_DEPENDENCIES` export lists every version the sandbox
guarantees.

---

## 3. Sidebar items: `icon` string only, no `onClick`

The iframe boundary can't carry a React node or a click handler, so
`SidebarItemConfig` tightened:

**Before:**

```tsx
ctx.sidebar.addItem({
  id: "my-addon",
  label: "My Addon",
  icon: <MyIcon />, // React node
  onClick: () => navigate(), // handler
});
```

**After:**

```tsx
ctx.sidebar.addItem({
  id: "my-addon",
  label: "My Addon",
  icon: "blocks", // host-provided icon name (lucide)
  route: "/addon/my-addon", // navigate via route instead of onClick
  order: 100,
});
```

---

## 4. Build config: externalize host dependencies (ESM)

Addons no longer bundle React et al., and the old
`rollup-plugin-external-globals` global-variable mapping
(`{ 'react-dom': 'ReactDOM' }`) no longer applies — there are no globals in the
sandbox. Mark the host-provided packages as ESM `external` with their **bare
specifiers**:

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const hostProvidedDependencies = [
  "@tanstack/react-query",
  "@wealthfolio/addon-sdk",
  "@wealthfolio/addon-sdk/host-api",
  "@wealthfolio/addon-sdk/host-dependencies",
  "@wealthfolio/addon-sdk/manifest",
  "@wealthfolio/addon-sdk/permissions",
  "@wealthfolio/addon-sdk/types",
  "@wealthfolio/addon-sdk/utils",
  "@wealthfolio/ui",
  "@wealthfolio/ui/chart",
  "date-fns",
  "lucide-react",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
  "recharts",
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: "src/addon.tsx",
      fileName: () => "addon.js",
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: { external: hostProvidedDependencies },
  },
});
```

Anything you import that is **not** in this list is bundled into your
`addon.js`. Only the versions the host guarantees (see `HOST_DEPENDENCIES` in
the SDK) should be externalized.

---

## 5. Manifest changes

Add `minWealthfolioVersion` and `hostDependencies`, and bump `sdkVersion`:

```json
{
  "sdkVersion": "3.6.0",
  "minWealthfolioVersion": "3.6.0",
  "hostDependencies": {
    "@tanstack/react-query": "^5.90.0",
    "@wealthfolio/addon-sdk": "^3.6.0",
    "@wealthfolio/ui": "^3.6.0",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.561.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "recharts": "^3.7.0"
  }
}
```

- `minWealthfolioVersion: "3.6.0"` makes the host refuse to load the addon on
  pre-sandbox builds (where the new render API doesn't exist), instead of
  loading it and failing at render time. Set it as soon as you adopt `render`.
- `hostDependencies` must match the packages you externalize in step 4. Keep the
  version ranges aligned with `HOST_DEPENDENCIES` in the installed SDK.

---

## 6. New capability: brokered network requests

Sandboxed addons can't make arbitrary `fetch` calls (opaque origin + CSP). To
reach an external API, declare the hosts in the manifest and call through the
host broker, which also injects auth from scoped secret storage:

```json
{
  "network": {
    "allowedHosts": ["api.example.com"]
  }
}
```

```ts
const res = await ctx.api.network.request({
  url: "https://api.example.com/v1/quote",
  method: "GET",
  auth: { type: "bearer", secretKey: "example-api-key" }, // resolved from ctx.api.secrets
});
// res: { status, headers, body }
```

Store the token once with `ctx.api.secrets.set('example-api-key', token)`; the
broker reads it by `secretKey` so the raw token never enters addon code paths.

---

## 7. Testing your migration

1. **Build**: `pnpm build` — confirm `addon.js` does **not** bundle React
   (externalized) and TypeScript compiles.
2. **Dev mode**: run the host with
   `VITE_ENABLE_ADDON_DEV_MODE=true pnpm tauri dev`, then `pnpm dev:server` in
   the addon directory.
3. **Verify render**: open the addon route and confirm the page paints inside
   the sandbox (not a blank frame).
4. **Verify lifecycle**: toggle the addon off/on — `onDisable` should
   `unmount()` cleanly with no console errors.

---

## 8. Common issues

| Symptom                                        | Cause / fix                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "Timed out … during loading sandbox document"  | Host build issue (e.g. CSP `frame-ancestors`) or `minWealthfolioVersion` newer than the host. |
| Blank frame, no errors                         | Still using `component:` — switch to `render` and mount into `ctx.root`.                      |
| Two React copies / hook errors                 | `react`/`react-dom` not in the `external` list — they got bundled. Add them (step 4).         |
| `React is undefined` / `ReactDOM is undefined` | Removed SDK exports. Import from `react` / `react-dom/client` directly.                       |
| Sidebar icon missing                           | `icon` must be a host icon name string, not a React node.                                     |
| `fetch` blocked                                | Use `ctx.api.network.request()` with the host declared in `manifest.network.allowedHosts`.    |

---

## 9. Need help

- [API Reference](./addon-api-reference.md)
- [Architecture Guide](./addon-architecture.md)
- [Getting Started](./addon-getting-started.md)
