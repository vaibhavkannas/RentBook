import { describe, expect, it } from "vitest";
import { HIKE_NOTICE_MONTHS, hikeAlerts, hikeMonthFor, type HikeAlert } from "@/lib/domain/alerts";
import { deriveMonthView, findEntryForMonth, findPriorEntry } from "@/lib/domain/month-view";
import { overdueList } from "@/lib/domain/overdue";
import { lastDueMonth, latestTenantStart } from "@/lib/domain/rent-due";
import { nextCount, startsNewCycle, suggestAmount } from "@/lib/domain/rent-rules";
import { sameTenantName, type Tenancy } from "@/lib/domain/tenancy";
import type { NextPayment, PortionConfig, PortionEntry, RentSnapshot, ScheduleRow, YearMonth } from "@/lib/domain/types";
import { latestEntryRow, monthOfDay, occupancyFor } from "@/lib/domain/vacancy";
import { addMonths, compareYm, ymKey } from "@/lib/domain/year-month";
import { deriveYearView } from "@/lib/domain/year-view";
import { type Entry, parsedRows, PORTIONS, tenancyRow } from "../support/fixtures";

// Two groups of generated Schedules, each checked over every month of every portion.
//
// 1. Payments within each cycle all equal to the cycle's first payment (the normal case, and all of the owner's data): every card,
//    summary figure, hike alert and overdue figure must be exactly what the OLD rule gave. The old rule is kept below as an oracle:
//    the suggestion follows the last payment, and a first payment of a new cycle within 10 rupees of the hike is the rent.
// 2. One-off amounts inside cycles, and first payments off the hike by any amount: the new rule, checked against the truth the
//    generator knows (the first payment of each cycle), never against the old rule.

// ---- The old rule, kept as the oracle -------------------------------------------------------------------------------------

/** The rounding allowance the old rule gave a first payment of a new cycle. */
const OLD_ALLOWANCE = 10;

function oldNextPayment(prior: PortionEntry, portion: PortionConfig): NextPayment {
  const newCycle = startsNewCycle(prior.count, portion.cycleLength);
  return {
    tenant: prior.tenant,
    count: nextCount(prior.count, portion.cycleLength),
    previousAmount: prior.amount,
    startsNewCycle: newCycle,
    suggestedAmount: suggestAmount(prior.amount, portion.hikePercent, newCycle),
  };
}

function oldReference(entry: PortionEntry | null, next: NextPayment | null): number | null {
  if (!next) return null;
  if (entry && !sameTenantName(entry.tenant, next.tenant)) return null;
  if (entry && next.startsNewCycle && Math.abs(entry.amount - next.suggestedAmount) <= OLD_ALLOWANCE) return entry.amount;
  return next.suggestedAmount;
}

function oldCard(rows: ScheduleRow[], portion: PortionConfig, month: YearMonth) {
  const entry = findEntryForMonth(rows, portion.id, month);
  const prior = findPriorEntry(rows, portion.id, month);
  const next = prior ? oldNextPayment(prior, portion) : null;
  const reference = oldReference(entry, next);
  return { entry, next, reference, difference: entry && reference !== null ? entry.amount - reference : null };
}

/** The old hikeAlerts: the same rule, with the latest payment as the current rent. */
function oldHikeAlerts(snapshot: RentSnapshot, today: string): HikeAlert[] {
  const { rows, portions, tenancies } = snapshot;
  const thisMonth = monthOfDay(today);
  const horizon = addMonths(thisMonth, HIKE_NOTICE_MONTHS);
  const alerts: HikeAlert[] = [];
  for (const portion of portions) {
    if (portion.inactive) continue;
    const latest = latestEntryRow(rows, portion.id);
    if (!latest) continue;
    const hike = hikeMonthFor(latest.month, latest.entry.count, portion.cycleLength);
    if (!hike || compareYm(hike.hikeMonth, horizon) > 0) continue;
    if (occupancyFor(rows, tenancies, portion.id, thisMonth).state === "vacant") continue;
    if (compareYm(hike.hikeMonth, thisMonth) > 0 && occupancyFor(rows, tenancies, portion.id, hike.hikeMonth).state === "vacant") continue;
    const currentRent = latest.entry.amount;
    const newRent = suggestAmount(currentRent, portion.hikePercent, true);
    if (!(newRent > currentRent)) continue;
    alerts.push({
      portionId: portion.id,
      name: portion.name,
      tenant: latest.entry.tenant,
      hikeMonth: hike.hikeMonth,
      paymentsLeft: hike.paymentsLeft,
      currentRent,
      newRent,
      hikePercent: portion.hikePercent,
      state: compareYm(hike.hikeMonth, thisMonth) <= 0 ? "due" : "soon",
    });
  }
  return alerts.sort((a, b) => compareYm(a.hikeMonth, b.hikeMonth));
}

// ---- The generator --------------------------------------------------------------------------------------------------------

/** A small seeded generator: the same seed always makes the same Schedule. */
function seeded(seed: number) {
  let state = (seed * 2654435761) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return {
    chance: (p: number) => next() < p,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

/** One payment as the generator made it, and the true rent of its cycle: the amount of the cycle's first payment. */
type Logged = { month: YearMonth; entry: PortionEntry; trueRent: number };

type Scenario = {
  seed: number;
  portions: PortionConfig[];
  rows: ScheduleRow[];
  tenancies: Tenancy[];
  logged: Record<string, Logged[]>;
  months: YearMonth[];
  today: string[];
};

/** What a group of generated Schedules covered, so the test can say it did not pass by checking nothing. */
function newCoverage() {
  return {
    cycles: new Set<string>(),
    hikes: new Set<number>(),
    tenantChanges: 0,
    gaps: 0,
    typedTwice: 0,
    oddOrder: 0,
    switchedOff: 0,
    midCycleStarts: 0,
    vacancies: 0,
    roundedFirstPayments: 0,
    oneOffs: 0,
    farFirstPayments: 0,
    permanentChanges: 0,
  };
}
type Coverage = ReturnType<typeof newCoverage>;

const TENANTS = ["Asha", "Bala", "Chitra", "Dev", "Esha", "Farah", "Gita"];

function generate(seed: number, oneOffs: boolean, covered: Coverage): Scenario {
  const r = seeded(seed);
  const start: YearMonth = { year: 2025, month: r.int(1, 12) };
  const length = r.int(12, 40);
  const months = Array.from({ length }, (_, index) => addMonths(start, index));

  const portions: PortionConfig[] = PORTIONS.map((portion) => {
    const cycleLength = r.pick([3, 11, 12, null] as const);
    const hikePercent = r.pick([0, 2.5, 5, 10] as const);
    const inactive = r.chance(0.15);
    covered.cycles.add(String(cycleLength));
    covered.hikes.add(hikePercent);
    if (inactive) covered.switchedOff++;
    return { ...portion, cycleLength, hikePercent, ...(inactive ? { inactive: true } : {}) };
  });

  const logged: Record<string, Logged[]> = {};
  for (const portion of portions) {
    const log: Logged[] = [];
    logged[portion.id] = log;
    const cycle = portion.cycleLength;
    let tenantIndex = r.int(0, TENANTS.length - 1);
    // Some portions start late, so months before the first payment are blank.
    const firstAt = r.chance(0.3) ? r.int(0, Math.floor(length / 3)) : 0;
    let last: Logged | null = null;
    months.forEach((month, index) => {
      if (index < firstAt) return;
      if (last !== null && r.chance(0.12)) {
        covered.gaps++;
        return;
      }
      let count: number;
      let amount: number;
      let tenant: string;
      let trueRent: number;
      if (last === null || r.chance(0.04)) {
        if (last !== null) {
          covered.tenantChanges++;
          tenantIndex = (tenantIndex + 1) % TENANTS.length;
        }
        tenant = TENANTS[tenantIndex];
        // The first entry of a portion may be in the middle of a cycle, as a Schedule that was begun by hand is.
        const midCycle = last === null && cycle !== null && cycle > 1 && r.chance(0.3);
        if (midCycle) covered.midCycleStarts++;
        count = midCycle ? r.int(2, cycle) : 1;
        amount = 50 * r.int(60, 400);
        trueRent = amount;
      } else {
        tenant = last.entry.tenant;
        count = nextCount(last.entry.count, cycle);
        if (cycle !== null && startsNewCycle(last.entry.count, cycle)) {
          // The first payment of a new cycle: the hike on the true rent, rounded by the owner in the normal case (within 10).
          const hiked = suggestAmount(last.trueRent, portion.hikePercent, true);
          const shift = oneOffs ? r.pick([0, 0, r.int(-10, 10), r.int(-400, 400)]) : r.int(-10, 10);
          amount = Math.max(1, hiked + shift);
          if (shift !== 0) covered.roundedFirstPayments++;
          if (Math.abs(shift) > OLD_ALLOWANCE) covered.farFirstPayments++;
          trueRent = amount;
        } else if (cycle === null) {
          // No cycle: the rent is the last payment (the rule keeps following it). A permanent change in the one-off group.
          amount = oneOffs && r.chance(0.2) ? Math.max(1, last.entry.amount + r.int(-400, 400)) : last.entry.amount;
          if (amount !== last.entry.amount) covered.permanentChanges++;
          trueRent = amount;
        } else {
          // Inside a cycle: the true rent again, or in the one-off group sometimes another amount, agreed for the month.
          amount = oneOffs && r.chance(0.2) ? Math.max(1, last.trueRent + r.int(-400, 400)) : last.trueRent;
          if (amount !== last.trueRent) covered.oneOffs++;
          trueRent = last.trueRent;
        }
      }
      last = { month, entry: { tenant, count, amount }, trueRent };
      log.push(last);
    });
  }

  // The Schedule's rows: every month, the entries of that month, some months typed twice and the rows in an odd order.
  const specs: Array<[number, number, Entry[]]> = months.map((month) => [
    month.year,
    month.month,
    portions.map((portion) => {
      const found = logged[portion.id].find((item) => compareYm(item.month, month) === 0);
      return found ? ([found.entry.tenant, found.entry.count, found.entry.amount] as Entry) : null;
    }),
  ]);
  const withTwice = [...specs];
  specs.forEach((spec) => {
    if (!r.chance(0.12)) return;
    covered.typedTwice++;
    // typed again below the first: the same payments, with some cells left blank (a blank cell hides nothing)
    const again: [number, number, Entry[]] = [spec[0], spec[1], spec[2].map((cell) => (r.chance(0.3) ? null : cell))];
    withTwice.splice(withTwice.indexOf(spec) + 1, 0, again);
  });
  if (r.chance(0.3)) {
    covered.oddOrder++;
    for (let index = withTwice.length - 1; index > 0; index--) {
      const swap = r.int(0, index);
      [withTwice[index], withTwice[swap]] = [withTwice[swap], withTwice[index]];
    }
  }
  const rows = parsedRows(...withTwice);

  // Some portions' last tenant has moved out, on a day inside the range or after it.
  const tenancies: Tenancy[] = [];
  portions.forEach((portion, index) => {
    const log = logged[portion.id];
    const tenant = log[log.length - 1]?.entry.tenant;
    if (tenant === undefined) return;
    if (r.chance(0.3)) {
      covered.vacancies++;
      const at = months[r.int(0, length - 1)];
      const day = `${ymKey(at)}-${String(r.int(1, 28)).padStart(2, "0")}`;
      tenancies.push(tenancyRow({ id: `t-${portion.id}`, rowNumber: index + 2, portionId: portion.id, tenant, moveOut: day }));
    } else if (r.chance(0.3)) {
      tenancies.push(tenancyRow({ id: `t-${portion.id}`, rowNumber: index + 2, portionId: portion.id, tenant }));
    }
  });

  const end = months[months.length - 1];
  const evaluated = Array.from({ length: length + 16 }, (_, index) => addMonths(addMonths(start, -2), index));
  const day = (month: YearMonth, d: number) => `${ymKey(month)}-${String(d).padStart(2, "0")}`;
  const today = [day(months[Math.floor(length / 2)], 17), day(end, 3), day(end, 20), day(addMonths(end, 3), 12)];
  return { seed, portions, rows, tenancies, logged, months: evaluated, today };
}

const SEEDS = Array.from({ length: 250 }, (_, index) => index + 1);

/** Keep the first few mismatches only: a failure should say where, not print thousands of lines. */
const verdict = (problems: string[]) => problems.slice(0, 5);

// ---- Group 1: the old rule is the oracle ----------------------------------------------------------------------------------

describe("payments equal within each cycle: every figure is what the old rule gave", () => {
  const covered = newCoverage();
  const scenarios = SEEDS.map((seed) => generate(seed, false, covered));

  it("gives every card the same next payment, reference and difference, and every month the same totals", () => {
    const problems: string[] = [];
    for (const sc of scenarios) {
      const byId = new Map(sc.portions.map((portion) => [portion.id, portion]));
      for (const month of sc.months) {
        const view = deriveMonthView(sc.rows, sc.portions, month, sc.tenancies);
        let due = 0;
        let difference = 0;
        let received = 0;
        for (const card of view.cards) {
          received += card.entry?.amount ?? 0;
          if (card.status === "vacant") {
            if (card.next !== null || card.rentReference !== null) problems.push(`${sc.seed} ${ymKey(month)} ${card.portionId} vacant`);
            continue;
          }
          const old = oldCard(sc.rows, byId.get(card.portionId)!, month);
          const same =
            JSON.stringify(card.next) === JSON.stringify(old.next) &&
            card.rentReference === old.reference &&
            card.rentDifference === old.difference &&
            JSON.stringify(card.entry) === JSON.stringify(old.entry) &&
            card.status === (old.entry ? "paid" : old.next ? "pending" : "needs-tenant");
          if (!same) problems.push(`${sc.seed} ${ymKey(month)} ${card.portionId}: ${JSON.stringify(card.next)} ${card.rentReference} vs ${JSON.stringify(old.next)} ${old.reference}`);
          due += old.reference ?? old.entry?.amount ?? 0;
          difference += old.difference ?? 0;
        }
        if (view.due !== due || view.difference !== difference || view.received !== received) {
          problems.push(`${sc.seed} ${ymKey(month)} totals ${view.due}/${view.difference} vs ${due}/${difference}`);
        }
      }
    }
    expect(verdict(problems)).toEqual([]);
  });

  it("gives every hike alert the same months and the same figures", () => {
    const problems: string[] = [];
    let alerts = 0;
    for (const sc of scenarios) {
      for (const today of sc.today) {
        const snapshot: RentSnapshot = { rows: sc.rows, portions: sc.portions, tenancies: sc.tenancies };
        const now = hikeAlerts(snapshot, today);
        alerts += now.length;
        if (JSON.stringify(now) !== JSON.stringify(oldHikeAlerts(snapshot, today))) problems.push(`${sc.seed} ${today}`);
      }
    }
    expect(verdict(problems)).toEqual([]);
    // the property is checked on alerts that exist, not only on none
    expect(alerts).toBeGreaterThan(100);
  });

  it("owes the old reference rent for every month the overdue list names, and names the same months", () => {
    const problems: string[] = [];
    let listed = 0;
    for (const sc of scenarios) {
      const byId = new Map(sc.portions.map((portion) => [portion.id, portion]));
      for (const today of sc.today) {
        const last = lastDueMonth(today);
        const expected: string[] = [];
        for (const portion of sc.portions) {
          const run = latestTenantStart(sc.rows, portion.id);
          if (!run) continue;
          for (let month = run.start; compareYm(month, last) <= 0; month = addMonths(month, 1)) {
            const card = deriveMonthView(sc.rows, sc.portions, month, sc.tenancies).cards.find((c) => c.portionId === portion.id);
            if (!card || card.status !== "pending") continue;
            const owed = Math.round(oldCard(sc.rows, byId.get(portion.id)!, month).reference ?? 0);
            if (owed > 0) expected.push(`${portion.id} ${ymKey(month)} ${owed}`);
          }
        }
        const actual = overdueList({ rows: sc.rows, portions: sc.portions, tenancies: sc.tenancies }, today).flatMap((item) =>
          item.months.map((m) => `${item.portionId} ${ymKey(m.month)} ${m.owed}`),
        );
        listed += actual.length;
        if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) problems.push(`${sc.seed} ${today}`);
      }
    }
    expect(verdict(problems)).toEqual([]);
    expect(listed).toBeGreaterThan(100);
  });

  it("gives the year view the old received and due", () => {
    const problems: string[] = [];
    for (const sc of scenarios.slice(0, 120)) {
      const byId = new Map(sc.portions.map((portion) => [portion.id, portion]));
      const today = sc.today[1];
      const last = lastDueMonth(today);
      const first = sc.rows.reduce<YearMonth | null>((best, row) => (best === null || compareYm(row.month, best) < 0 ? row.month : best), null)!;
      for (const year of [sc.months[0].year, sc.months[0].year + 1]) {
        let received = 0;
        let due = 0;
        for (let m = 1; m <= 12; m++) {
          const month = { year, month: m };
          if (compareYm(month, first) < 0) continue;
          for (const card of deriveMonthView(sc.rows, sc.portions, month, sc.tenancies).cards) {
            if (card.status === "paid") {
              const old = oldCard(sc.rows, byId.get(card.portionId)!, month);
              received += card.entry!.amount;
              due += old.reference ?? card.entry!.amount;
            } else if (card.status === "pending" && compareYm(month, last) <= 0) {
              due += oldCard(sc.rows, byId.get(card.portionId)!, month).reference ?? 0;
            }
          }
        }
        const view = deriveYearView({ rows: sc.rows, portions: sc.portions, tenancies: sc.tenancies }, year, today);
        if (view.received !== received || view.due !== due) problems.push(`${sc.seed} ${year}: ${view.received}/${view.due} vs ${received}/${due}`);
      }
    }
    expect(verdict(problems)).toEqual([]);
  });

  it("covered the cases it names: cycles of 3, 11, 12 and none, every hike, tenant changes, gaps, months typed twice, odd order, switched-off portions, mid-cycle starts and vacancies", () => {
    expect([...covered.cycles].sort()).toEqual(["11", "12", "3", "null"]);
    expect([...covered.hikes].sort((a, b) => a - b)).toEqual([0, 2.5, 5, 10]);
    for (const name of ["tenantChanges", "gaps", "typedTwice", "oddOrder", "switchedOff", "midCycleStarts", "vacancies", "roundedFirstPayments"] as const) {
      expect(covered[name], name).toBeGreaterThan(20);
    }
    // the normal group has no one-off amounts and no first payment more than 10 rupees off the hike
    expect(covered.oneOffs).toBe(0);
    expect(covered.farFirstPayments).toBe(0);
    expect(covered.permanentChanges).toBe(0);
  });
});

// ---- Group 2: the truth the generator knows ----------------------------------------------------------------------------

describe("one-off amounts and first payments of any amount: the figures follow the true rent of each cycle", () => {
  const covered = newCoverage();
  const scenarios = SEEDS.map((seed) => generate(1000 + seed, true, covered));

  /** What the card of a portion's month must say, from the log the generator wrote. */
  function expectedCard(sc: Scenario, portion: PortionConfig, month: YearMonth) {
    const log = sc.logged[portion.id];
    const entry = log.find((item) => compareYm(item.month, month) === 0)?.entry ?? null;
    const before = log.filter((item) => compareYm(item.month, month) < 0);
    const prior = before[before.length - 1];
    if (!prior) return { entry, next: null, reference: null, difference: null };
    // No cycle: the rent is the last payment. Otherwise it is the cycle's first payment.
    const base = portion.cycleLength === null ? prior.entry.amount : prior.trueRent;
    const newCycle = startsNewCycle(prior.entry.count, portion.cycleLength);
    const next: NextPayment = {
      tenant: prior.entry.tenant,
      count: nextCount(prior.entry.count, portion.cycleLength),
      previousAmount: base,
      startsNewCycle: newCycle,
      suggestedAmount: suggestAmount(base, portion.hikePercent, newCycle),
    };
    let reference: number | null = next.suggestedAmount;
    if (entry && !sameTenantName(entry.tenant, next.tenant)) reference = null;
    else if (entry && newCycle) reference = entry.amount;
    return { entry, next, reference, difference: entry && reference !== null ? entry.amount - reference : null };
  }

  it("gives every card the next payment, reference and difference the cycle's first payment says", () => {
    const problems: string[] = [];
    for (const sc of scenarios) {
      const byId = new Map(sc.portions.map((portion) => [portion.id, portion]));
      for (const month of sc.months) {
        for (const card of deriveMonthView(sc.rows, sc.portions, month, sc.tenancies).cards) {
          if (card.status === "vacant") continue;
          const want = expectedCard(sc, byId.get(card.portionId)!, month);
          const same =
            JSON.stringify(card.next) === JSON.stringify(want.next) &&
            card.rentReference === want.reference &&
            card.rentDifference === want.difference;
          if (!same) problems.push(`${sc.seed} ${ymKey(month)} ${card.portionId}: ${JSON.stringify(card.next)} ${card.rentReference} vs ${JSON.stringify(want.next)} ${want.reference}`);
        }
      }
    }
    expect(verdict(problems)).toEqual([]);
  });

  it("never lets a first payment of a new cycle read as more or less than rent", () => {
    let seen = 0;
    for (const sc of scenarios) {
      for (const month of sc.months) {
        for (const card of deriveMonthView(sc.rows, sc.portions, month, sc.tenancies).cards) {
          if (card.status === "paid" && card.next?.startsNewCycle && card.rentReference !== null) {
            seen++;
            expect(card.rentDifference).toBe(0);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it("suggests, after a one-off amount inside a cycle, what it suggested before it", () => {
    // for every portion with a cycle, the suggestion after each payment equals the true rent (or its hike), which one-offs do not move
    let oneOffs = 0;
    for (const sc of scenarios) {
      for (const portion of sc.portions) {
        if (portion.cycleLength === null) continue;
        for (const item of sc.logged[portion.id]) {
          if (item.entry.amount === item.trueRent || item.entry.count === 1) continue;
          oneOffs++;
          const after = addMonths(item.month, 1);
          const hasEntry = sc.logged[portion.id].some((other) => compareYm(other.month, after) === 0);
          if (hasEntry) continue;
          const card = deriveMonthView(sc.rows, sc.portions, after, sc.tenancies).cards.find((c) => c.portionId === portion.id);
          if (card?.next) expect(card.next.previousAmount).toBe(item.trueRent);
        }
      }
    }
    expect(oneOffs).toBeGreaterThan(50);
  });

  /** The hike alerts the log says there are: the old rule's conditions, with the true rent of the latest payment's cycle. */
  function expectedAlerts(sc: Scenario, today: string): string[] {
    const thisMonth = monthOfDay(today);
    const horizon = addMonths(thisMonth, HIKE_NOTICE_MONTHS);
    const found: string[] = [];
    for (const portion of sc.portions) {
      const log = sc.logged[portion.id];
      const latest = log[log.length - 1];
      if (portion.inactive || !latest) continue;
      const hike = hikeMonthFor(latest.month, latest.entry.count, portion.cycleLength);
      if (!hike || compareYm(hike.hikeMonth, horizon) > 0) continue;
      if (occupancyFor(sc.rows, sc.tenancies, portion.id, thisMonth).state === "vacant") continue;
      if (compareYm(hike.hikeMonth, thisMonth) > 0 && occupancyFor(sc.rows, sc.tenancies, portion.id, hike.hikeMonth).state === "vacant") continue;
      const newRent = suggestAmount(latest.trueRent, portion.hikePercent, true);
      if (!(newRent > latest.trueRent)) continue;
      found.push(`${portion.id} ${ymKey(hike.hikeMonth)} ${latest.trueRent} ${newRent}`);
    }
    return found;
  }

  it("gives every hike alert the true rent and its hike, and loses none", () => {
    const problems: string[] = [];
    let alerts = 0;
    for (const sc of scenarios) {
      const snapshot: RentSnapshot = { rows: sc.rows, portions: sc.portions, tenancies: sc.tenancies };
      for (const today of sc.today) {
        const actual = hikeAlerts(snapshot, today).map((a) => `${a.portionId} ${ymKey(a.hikeMonth)} ${a.currentRent} ${a.newRent}`);
        alerts += actual.length;
        if (JSON.stringify([...actual].sort()) !== JSON.stringify(expectedAlerts(sc, today).sort())) problems.push(`${sc.seed} ${today}`);
      }
    }
    expect(verdict(problems)).toEqual([]);
    expect(alerts).toBeGreaterThan(100);
  });

  it("owes the card's reference rent in the overdue list, which follows the true rent", () => {
    const problems: string[] = [];
    let listed = 0;
    for (const sc of scenarios) {
      const byId = new Map(sc.portions.map((portion) => [portion.id, portion]));
      for (const today of sc.today) {
        const last = lastDueMonth(today);
        const expected: string[] = [];
        for (const portion of sc.portions) {
          const run = latestTenantStart(sc.rows, portion.id);
          if (!run) continue;
          for (let month = run.start; compareYm(month, last) <= 0; month = addMonths(month, 1)) {
            const card = deriveMonthView(sc.rows, sc.portions, month, sc.tenancies).cards.find((c) => c.portionId === portion.id);
            if (!card || card.status !== "pending") continue;
            const owed = Math.round(expectedCard(sc, byId.get(portion.id)!, month).reference ?? 0);
            if (owed > 0) expected.push(`${portion.id} ${ymKey(month)} ${owed}`);
          }
        }
        const actual = overdueList({ rows: sc.rows, portions: sc.portions, tenancies: sc.tenancies }, today).flatMap((item) =>
          item.months.map((m) => `${item.portionId} ${ymKey(m.month)} ${m.owed}`),
        );
        listed += actual.length;
        if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) problems.push(`${sc.seed} ${today}`);
      }
    }
    expect(verdict(problems)).toEqual([]);
    expect(listed).toBeGreaterThan(100);
  });

  it("covered one-off amounts, first payments far off the hike and permanent changes where the count never resets", () => {
    for (const name of ["oneOffs", "farFirstPayments", "permanentChanges"] as const) {
      expect(covered[name], name).toBeGreaterThan(50);
    }
  });
});
