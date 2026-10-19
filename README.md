# NAAYAN - Wholesale & POS Billing

React + Vite billing, inventory and order administration for NAAYAN, backed by **Neon PostgreSQL**.

## How it fits together

```
Browser (React)  ──fetch──▶  /api/*  (server/ — Vercel function api/[route].ts, or Vite dev middleware)  ──pg──▶  Neon
```

- The browser never holds database credentials. `src/lib/db.ts` keeps the familiar
  `db.from('orders').select()...` / `db.rpc(...)` API and sends each request to `/api/db` or `/api/rpc`.
- `server/query.ts` turns those requests into parameterised SQL; table, column and relationship names
  are checked against the live schema, and only the stored procedures in `server/schema.ts` can be called.
- Admin/staff sign-in is checked on the server (`/api/auth`) and returns a signed session token that
  every database request must carry. Signed-out visitors can only read the shop branding and open a
  bill by its exact id/number (the public invoice page).
- Files (product images, invoice PDFs, logos) are stored in `public.storage_files` and served from
  `/api/files`. Live updates poll `/api/versions`, whose counters are bumped by triggers.
- Supabase Auth is kept only, and optionally, for the customer sign-in page (`/login`).

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `SESSION_SECRET`
   and the admin/staff credentials.
3. `npm run db:migrate` — creates the schema in Neon (safe to re-run; applied files are skipped).
4. `npm run dev` — the app and the `/api` routes run together on one port.

## Moving existing data from Supabase

Add `SUPABASE_DB_URL` (and, for images/PDFs, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) to `.env`, then:

```bash
npm run db:import-supabase -- --dry-run   # shows what would be copied
npm run db:import-supabase -- --yes       # replaces Neon's app data with the Supabase copy
```

The copy runs in one transaction, re-points file links to `/api/files`, and finishes by comparing row
counts and money totals (orders, bill items, advance orders, payments, expenses, stock) on both sides.
Switch production over only after it prints "All counts and totals match."

## Deploying to Vercel

Set these in Vercel → Project → Settings → Environment Variables (Production and Preview), then redeploy:
`DATABASE_URL` (pooled), `SESSION_SECRET`, `ADMIN_ID`, `ADMIN_PASSWORD`, `STAFF_ID`, `STAFF_PASSWORD`.
Optional: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` for customer sign-in.
Remove the old `VITE_ADMIN_*` / `VITE_STAFF_*` variables — `VITE_` values are bundled into the browser.

## Split payments (cash + QR)

POS bills, advance-order deposits and advance-order final payments can be paid with the **Split** option. Enter how much was
collected by cash and QR; the amounts must add up to the bill / deposit / final amount. The analytics dashboard shows
**Cash Collected**, **QR Collected** and **Card Collected** KPI cards that count split payments by their parts.
Advance-order split payments need migration `20260930_0023_split_payments.sql`, which `npm run db:migrate` applies.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | Neon **pooled** connection string, used by the API |
| `DATABASE_URL_UNPOOLED` | local | Neon direct connection, used by `npm run db:migrate` |
| `SESSION_SECRET` | server | Signs portal session tokens (32+ random bytes) |
| `ADMIN_ID` / `ADMIN_PASSWORD` | server | Admin sign-in |
| `STAFF_ID` / `STAFF_PASSWORD` | server | Staff sign-in |
| `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | local | One-time data import only |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | browser | Optional customer sign-in (Supabase Auth) |

Never give a database or server variable a `VITE_` prefix.

## Brand Identity & Contact

- **Store Name:** NAAYAN
- **Owner:** Balaji K
- **Address:** 14/1 West Car Street, Nehru Maidhanam, Chokkalingapuram, Aruppukottai - 626101
- **Theme:** grey (accent `#3F3F46`)

Phone numbers, email, Instagram, logo, tagline and the accent colour are edited by the admin in
**Dashboard → Settings**. They are saved in Supabase (`store_settings`, see `neon/migrations/`) and cached on each device. Defaults live in `src/lib/brand.ts`.

## Logo

The default logo is `public/naayan-logo.png`. Upload the real logo from Dashboard → Settings, or replace that file
(keep the same name) and run `npm run generate:icons` to regenerate the PWA icons, favicons and the print/PDF logo.
