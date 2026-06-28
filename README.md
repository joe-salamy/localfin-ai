# AI Budget App v2

Local-first personal finance tracker with AI-powered transaction parsing. Paste or type transactions in natural language and the app categorizes and stores them automatically.

## Features

- **AI transaction parsing** — enter transactions in plain text; the LLM extracts amounts, dates, categories, and accounts
- **Dashboard** — spending breakdowns, category summaries, Sankey flow diagrams, and net worth chart
- **Accounts & categories** — manage bank accounts, custom categories/subcategories
- **Transaction history** — search, bulk edit, and delete past transactions
- **Goals** — set and track financial goals

## Stack

- **Frontend:** React 19, React Router, TanStack Query, Tailwind CSS, Recharts, Nivo
- **Backend:** Express 5, better-sqlite3 (stored in `data/budget.db`)
- **AI:** OpenRouter API (Gemma 3n) for parsing and categorization

## Setup

```bash
npm install
```

Create a `.env` file:

```
OPENROUTER_API_KEY=your_openrouter_key
LOCALFIN_PROVIDER_SECRET=at_least_32_random_characters
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox
PLAID_REDIRECT_URI=http://localhost:5173/setup
AKOYA_CLIENT_ID=...
AKOYA_CLIENT_SECRET=...
AKOYA_AUTH_BASE_URL=https://sandbox-idp.ddp.akoya.com
AKOYA_API_BASE_URL=https://sandbox-products.ddp.akoya.com
AKOYA_REDIRECT_URI=http://localhost:3001/api/account-linking/akoya/callback
AKOYA_CONNECTOR=mikomo
AKOYA_PROVIDER_ID=mikomo
AKOYA_API_VERSION=v3
FRONTEND_BASE_URL=http://localhost:5173
```

Get a free OpenRouter API key at [openrouter.ai](https://openrouter.ai/).
Provider linking is manual sync only. `LOCALFIN_PROVIDER_SECRET` encrypts
provider credentials at rest; keep it stable after linking accounts. For
Fidelity production through Akoya, replace `AKOYA_CONNECTOR` and
`AKOYA_PROVIDER_ID` with the Fidelity values from Akoya Data Recipient Hub.

## Development

```bash
npm run dev           # starts Vite (port 5173) + Express (port 3001) concurrently
npm run dev:client    # frontend only
npm run dev:server    # backend only
npm run build         # production build
```

The database is auto-created and seeded on first server start.

## Project Structure

```
src/                  # React frontend
  pages/              # route-level components
  components/         # UI and feature components
  hooks/              # React Query hooks
  lib/                # API client, utils, query config
server/               # Express backend
  routes/             # API route handlers
  services/           # business logic
  db/                 # schema, seed, connection
  ai/                 # OpenRouter integration
```
