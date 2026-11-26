# Delivered Orders Excuse Geography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sale matched to a delivered, uniquely tracked order is set aside from the out-of-state test (B6 and the combined score), when the merchant's orders overall pass the 90% delivered bar.

**Architecture:** One pure function in `passport.ts` returns the excused sale ids. `investigate()` folds it into the existing `covered(e, 'area')` hook. `runInvestigation()` already scores twice for passports (bare, then explained, keeping the bare score when conduct fires); it now also does that when sales are excused.

**Tech Stack:** TypeScript, tsx, the repo's own test runner (`tests/run.ts`, files export a default function returning the number of failed assertions).

**Spec:** `docs/superpowers/specs/2026-11-26-delivered-orders-excuse-geography-design.md`

## Global Constraints

- Excuse applies on the `area` axis only. `hours` and `amount` are untouched.
- Guard: at least 90% of **all** the merchant's orders `DELIVERED` with a tracking number no other order uses (same count as F7). Below that, nothing is excused.
- B10 is not changed.
- Explains change, never conduct: if the bare score has a conduct signal, or the explained score creates one, the bare score stands.
- No new dependencies, no new rules file.

## Review Focus

1. Out-of-state sales **without** a matching order on a merchant that passes the guard: still counted by B6. (Task 1 test `unmatched still counts`.)
2. A delivered order with no `trackingId`: not excused. (Task 1 test `no tracking not excused`.)
3. Sale matched by `PaymentEvent.orderId` rather than `OrderRecord.saleId`: excused. (Task 1 test `matched by orderId`.)
4. Conduct signal present: the order excuse is dropped, same as a passport. (Task 2 relies on the existing two-pass code; covered by `npm test` regressions on the betting-front samples.)
5. Merchant with no orders: result identical to today, no second scoring pass. (Task 2 test `no orders unchanged`.)

---

### Task 1: `deliveredOrderCover`

**Files:**
- Modify: `frontend/src/engines/passport.ts` (add one exported function after `passportCover`)
- Test: `tests/engine/detectors-edge.test.ts` (new block right after the B6 section, ~line 273; reuses `mkSale` / `mkBaseScenario`)

**Interfaces:**
- Produces: `export function deliveredOrderCover(sc: Scenario): Set<string>`: ids of the primary merchant's SALE events to excuse on `area`.

- [ ] **Step 1: Write the failing tests** (import `deliveredOrderCover` from `../../frontend/src/engines/passport`)

```ts
// B6 delivered-order excuse
{
  const far = (i: number) => mkSale(i, { payerState: ['DL', 'UP', 'WB', 'PB'][i % 4] });
  const base = mkBaseScenario({ events: Array.from({ length: 40 }, (_, i) => far(i)) }); // all 40 orders DELIVERED, unique TRK
  check('delivered + unique tracking excused', deliveredOrderCover(base).size === 40);

  const reused = mkBaseScenario({ events: base.events, orders: base.orders.map(o => ({ ...o, trackingId: 'TRK-SAME' })) });
  check('reused tracking fails guard', deliveredOrderCover(reused).size === 0);

  const undelivered = mkBaseScenario({ events: base.events, orders: base.orders.map((o, i) => i < 5 ? { ...o, status: 'NONE' as const } : o) }); // 87.5% < 90%
  check('below 90% delivered excuses nothing', deliveredOrderCover(undelivered).size === 0);

  const noTrack = mkBaseScenario({ events: base.events, orders: base.orders.map((o, i) => i === 0 ? { ...o, trackingId: undefined } : o) });
  check('no tracking not excused', !deliveredOrderCover(noTrack).has('S-0'));

  const byOrderId = mkBaseScenario({ events: base.events, orders: base.orders.map(o => ({ ...o, saleId: 'unknown' })) });
  check('matched by orderId', deliveredOrderCover(byOrderId).has('S-3'));

  const unmatched = mkBaseScenario({ events: base.events, orders: base.orders.slice(0, 20) });
  check('unmatched still counts', !deliveredOrderCover(unmatched).has('S-30') && deliveredOrderCover(unmatched).has('S-0'));
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `MRE_CASE_STORE=memory npx tsx tests/run.ts 2>&1 | grep -E "detectors-edge|delivered|tracking|orderId|unmatched"`
Expected: failure (import of `deliveredOrderCover` missing).

- [ ] **Step 3: Implement `deliveredOrderCover(sc: Scenario): Set<string>` in `frontend/src/engines/passport.ts`**

Count tracking ids across `sc.orders`; an order is good when `status === 'DELIVERED'` and its `trackingId` is set and used once. If good / `sc.orders.length` < 0.9 (or no orders) return an empty set. Otherwise return the ids of primary-merchant SALE events for which a good order has `saleId === e.id` or (`e.orderId` set and `orderId === e.orderId`). Comment the 0.9 as "same bar as F7".

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2. Expected: all six new checks `✓`, no `✗` in detectors-edge.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engines/passport.ts tests/engine/detectors-edge.test.ts
git commit -m "feat: deliveredOrderCover picks sales excused by delivered orders"
```

### Task 2: Wire the excuse into scoring

**Files:**
- Modify: `frontend/src/engines/investigationEngine.ts:63-100` (`runInvestigation`, `investigate`)
- Test: `tests/engine/detectors-edge.test.ts` (same block as Task 1; import `runInvestigation` from `../../frontend/src/engines/investigationEngine`)

**Interfaces:**
- Consumes: `deliveredOrderCover(sc: Scenario): Set<string>` from Task 1.
- Produces: `investigate(sc, opts: { draws?; learnedRates?; orderExcuse?: boolean })`: `orderExcuse` defaults to `true`.

- [ ] **Step 1: Write the failing tests**

```ts
{
  const far = (i: number) => mkSale(i, { payerState: ['DL', 'UP', 'WB', 'PB'][i % 4] });
  const b6 = (sc: Scenario) => runInvestigation(sc, { draws: 0 }).evidence.find(e => e.id === 'B6')!;
  const shipped = mkBaseScenario({ events: Array.from({ length: 40 }, (_, i) => far(i)) });
  check('delivered online orders clear B6', b6(shipped).status !== 'ILLICIT');
  const unshipped = mkBaseScenario({ events: shipped.events, orders: shipped.orders.map(o => ({ ...o, status: 'NONE' as const })) });
  check('undelivered orders still fire B6', b6(unshipped).status === 'ILLICIT');
  const none = mkBaseScenario({ events: shipped.events, orders: [] });
  check('no orders unchanged', b6(none).status === 'ILLICIT');
}
```

- [ ] **Step 2: Run to verify it fails**

Run: same command as Task 1 Step 2. Expected: `✗ delivered online orders clear B6`.

- [ ] **Step 3: Implement**

- In `investigate`: `const excused = opts.orderExcuse === false ? new Set<string>() : deliveredOrderCover(sc)`, `const pass = passportCover(sc)`, `covered = (e, axis) => pass(e, axis) || (axis === 'area' && excused.has(e.id))`.
- In `runInvestigation`: early return only when no passports in force **and** `deliveredOrderCover(sc).size === 0`. The bare pass is `investigate({ ...sc, passports: [] }, { ...opts, orderExcuse: false })`. Set `passportsSuspended: true` on `asScored` only when passports are in force.
- When bare `followUp === 'ASK'` and explained is `'NONE'`: keep the passport line when passports were in force, and when sales were excused append `` ` ${n} out-of-state payments were set aside as delivered online orders.` `` to `fusion.gateReason`.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: exits 0. If a sample's decision changes, check it is a merchant with ≥ 90% delivered unique-tracked orders and say so in the commit message; a betting-front sample changing decision is a bug.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engines/investigationEngine.ts tests/engine/detectors-edge.test.ts
git commit -m "feat: delivered online orders excuse out-of-state payers"
```
