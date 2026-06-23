# ckitchen_frontend

Web client for **CloudKitchen ONE** — the unified order dashboard, kitchen display, inventory,
and analytics UI.

- **Stack:** React + Vite + TypeScript + Tailwind CSS.
- **Realtime:** Supabase Realtime (order/stock/print events) — feed updates within ~2 s.
- **Talks to:** `WebsitePojects/ckitchen_backend` API over HTTPS/WSS.

## Key UI surfaces
Unified Order Dashboard (one feed across all brands/aggregators, brand color labels, aggregator
badges, audible alert on new order) · Kitchen Display (station-grouped, elapsed prep time) ·
Inventory (two tiers + ITO) · Analytics (per-brand rank, peak-hour, aggregator split) · Admin.

> The web app **NEVER prints directly** — it only creates/queues print jobs and shows status.
> The desktop Print Agent does the physical printing.

## Source of truth
See the umbrella workspace `.claude/` folder + `Documents/CK1-*`. Status: pre-build (Phase 0).
