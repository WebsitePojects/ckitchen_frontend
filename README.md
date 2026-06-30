# ckitchen_frontend

Web client for **CloudKitchen ONE** — the dark, dashboard-style UI for orders, kitchen display,
outlets & channel listings, inventory + stock ledger, master data, employees, photo attendance
(DTR), audit log, and analytics.

- **Stack:** React 18 + Vite 5 + TypeScript + Tailwind CSS + shadcn-style UI (Radix) + lucide icons.
- **Data/realtime:** talks to [`ckitchen_backend`](../ckitchen_backend) over HTTPS/WSS (Axios + Socket.IO).
- **Print:** the web app **never prints directly** — it queues print jobs; the Print Agent prints.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | **≥ 20** (20 LTS or 22 LTS recommended) | 24.x also works |
| **npm** | ≥ 10 | ships with Node |
| Backend API | running | local `ckitchen_backend` (or a deployed URL) for data |

Check yours: `node -v && npm -v`.

---

## Quick start (local)

```bash
# 1. install
npm install

# 2. configure environment (optional for local — see note below)
cp .env.example .env

# 3. run the dev server
npm run dev
#    → http://localhost:5173
```

**Backend connection:**
- **Local dev:** leave `VITE_API_URL` empty. The Vite dev proxy (in `vite.config.ts`) forwards
  `/api/*` to your local backend (default `http://localhost:5003`). Start the backend first.
- **Pointing at a deployed backend:** set `VITE_API_URL=https://<backend-origin>` in `.env`,
  then restart (Vite reads env at startup; production bakes it at build time).

Login with the backend's seeded admin: `admin@cloudkitchen.local` / `admin123`.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload (port 5173). |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/`. |
| `npm run preview` | Serve the built `dist/` locally to sanity-check a prod build. |
| `npm run typecheck` | Type-check only, no emit. |
| `npm run lint` | ESLint (note: `eslint` may not be installed yet — `npm i -D eslint` first). |

---

## Project layout

```
src/
  main.tsx, App.tsx          # entry + route table (protected AppShell)
  auth/                      # AuthContext, RequireAuth (JWT in localStorage)
  lib/api.ts                 # Axios client — base URL + bearer token interceptor
  components/
    layout/                  # AppShell, sidebar nav-items.ts
    common/                  # PageHeader, KpiCard/Ribbon, EmptyState, StatusBadge
    ui/                      # shadcn-style primitives (card, table, dialog, select…)
  pages/                     # Dashboard, Orders, Outlets, ChannelListings, Brands,
                             # Kitchen, Printers, Menu, Inventory, StockLedger,
                             # MasterData, Users, Employees, Attendance (DTR),
                             # AuditTrail, Analytics, Settings, Login
```

All API calls go through `src/lib/api.ts` (`get`/`post`/`patch`/`put`/`del`), which attaches the
stored JWT automatically and normalizes error responses.

---

## Deployment

- Hosted on **Vercel** (SPA). `vercel.json` provides SPA rewrites; set **`VITE_API_URL`** (or
  `VITE_API_PROXY_TARGET`) to the deployed backend origin in the Vercel project env.
- Vite bakes env vars at **build time** — change them, then redeploy.

---

## Notes

- Dark theme, ≥4.5:1 contrast, lucide icons only (no emoji), `tabular-nums` for figures.
- The Attendance/DTR page uses the browser webcam (`getUserMedia`) to capture a photo on punch;
  it needs camera permission and a backend with Cloudinary configured.

## Source of truth

Architecture, business rules, and the UI design system live in the **umbrella workspace**
`.claude/` folder + `Documents/CK1-*` specs.
