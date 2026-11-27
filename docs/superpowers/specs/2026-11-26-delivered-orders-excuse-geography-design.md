# Delivered online orders excuse out-of-state payers

Short design, 2026-11-26.

## Why

A local shop (bakery, sweets, restaurant: any category whose norm is `LOCAL` in `rules/mcc.json`) that starts selling online
gets flagged by B6 ("payers from far away") because its online buyers live in other states. Today only a verified
Context Passport can excuse that, which needs a reviewer. Delivered, uniquely tracked orders are already good evidence
that a distant payer was a real customer, so they should excuse that payment automatically.

## Goals / non-goals / anti-goals

- Goal: a payment matched to a really delivered order is left out of the out-of-state test, on any payment type
  (card, netbanking, wallet, UPI link, QR).
- Non-goal: changing which categories are national, or how passports work.
- Anti-goal: a front mixing a few real deliveries with betting deposits gets its deposits excused. Out-of-state
  payments **without** a delivered order must still count in full.

## Approaches considered

- **A. Per-payment excuse (picked).** Each payment whose order is delivered with a unique tracking number is set aside
  on the `area` axis, the same way a passport sets payments aside. Smallest change; unmatched payments stay visible.
- B. Whole link treated as national once its orders look good. Rejected: also excuses the unmatched payments on that link,
  which is where side money hides.
- C. Auto-draft a passport for a reviewer. Rejected: not automatic, adds reviewer work.

## Design

1. **Which payments are excused.** A SALE `e` is excused on the `area` axis when an order in `sc.orders` has
   `saleId === e.id` (or `orderId === e.orderId`), `status === 'DELIVERED'`, and a `trackingId` that no other order uses.
2. **Guard.** Nothing is excused unless the merchant's orders overall pass the F7 bar: at least 90% of all orders
   delivered with unique tracking (same count F7 makes, across all the merchant's orders, not per link or channel).
3. **Where.** Extend the existing `covered(e, axis)` hook (`frontend/src/engines/passport.ts`, built in
   `investigationEngine.ts`): `covered = passport cover || (axis === 'area' && excused.has(e.id))`. B6 and the combined
   score at `detectors.ts:369` already honour `covered(e, 'area')`, so no detector changes.
4. **Explains change, never conduct.** Same rule as passports: `runInvestigation` scores first without the order excuse;
   if a conduct signal fires, that score stands. It also runs the two-pass path when there are excused payments, not
   only when passports are in force. The engine should not strip `sc.orders` for the bare pass (F7/D10 need them);
   a flag on `investigate` turning the excuse off is enough.
5. **B10 unchanged.** Distant payers who pay every few days still count, delivered orders or not.
6. **Traceable.** When the excuse turns an ASK into NONE, append a line to `fusion.gateReason` saying how many payments
   were set aside as delivered online orders, as passports do today.

## Check left behind

One assert-based case in `scripts/selftest.ts`: a LOCAL-category merchant whose out-of-state sales all have delivered,
uniquely tracked orders gets B6 not ILLICIT; the same merchant with those orders marked `NONE` (or with tracking reused)
still gets B6 firing.

## Left to the builder

Exact matching between payments and orders (`saleId` vs `orderId`, whichever the data uses), and the wording of the
gate-reason line.
