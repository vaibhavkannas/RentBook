# RentBook

A phone-first web app for recording monthly rent receipts for a building with five portions. It writes into your existing Google Sheet, which stays the only place the data lives.

- Month overview with one card per portion: tenant, payment count, rent, Paid or Pending.
- Log a payment in a few taps. The count and the 5% hike suggestion are worked out for you, and you can edit the amount.
- Per-portion cycle length (or "never resets") and hike percent.
- Each payment also lands in a `Payments Log` tab with the date it was received.

## Develop

```bash
npm install
cp .env.example .env.local   # then fill it in, see SETUP.md
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run recon` | Read-only check of your Google Sheet. Never writes |

## Setup and deployment

See [SETUP.md](SETUP.md).

## How it works

Rules live in `src/lib/domain` (pure, no I/O). Everything that touches the Sheet is in `src/lib/sheets`, behind one interface, so tests use an in-memory fake. Design notes are in `docs/superpowers/specs/`.
