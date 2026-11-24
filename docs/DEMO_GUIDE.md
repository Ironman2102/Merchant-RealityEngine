# Demo walkthrough

All data is synthetic. Tick **Fast simulation** before you start.

## The three-minute demo

1. **Betting on the side** (`/demo`). Run it. Point at "Scored QR by QR": the counter QR is normal and `PL-GOB-03` opens a case.
   The recommended response restricts that link only.
2. **Honest change: midnight delivery.** Run it. The result is a question with nothing restricted. Press **Simulate second-person
   check** in the Context Passport. The result becomes "No case".
3. **Legitimate Diwali growth.** Run it. Nothing to explain.

Use **Sweet Crumbs** when asked about crawlers, refunds or match timing.

## Showing maker and checker

1. `npm run dev:users`, then read the local passwords from `backend/data/dev-users.txt`.
2. Sign in as `dev-analyst`, analyse a test file, propose L3 in the response plan. Try to approve it: refused.
3. In a second browser profile sign in as `dev-reviewer` and approve.

The same two people can record and verify a Context Passport on the Moonlight Bakes test file.

## Before every rehearsal and the real demo

Restrictions, decisions and passports follow the merchant, so a second run on the same database shows the first run's results.
Start each run on an empty one, in one terminal:

```bash
export MRE_DB_FILE="$(mktemp -d)/demo.db"
npm run dev:users   # the last four lines of backend/data/dev-users.txt are the passwords for this run
./start.sh
```

## Fallback

Keep a screen recording. `/demo` works offline once loaded and needs no sign-in or server.
