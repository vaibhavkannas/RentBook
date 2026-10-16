/**
 * Exercises log, edit, undo, Activity, the cache and the tenancy details (Tenants tab) against a TEST COPY
 * of the Sheet, through the real Google API. It refuses to run against the real Sheet.
 *
 *   TEST_SHEET_ID=<id of the test copy> npm run verify:testcopy
 *
 * It writes to the test copy, only for portion p5 and the month 2040-04:
 *  - one payment is logged (as a new tenant "Verify Tenant", with tenancy details), edited and undone, and
 *    three rows are added to the Payments Log;
 *  - the tenancy is edited, a save from a stale screen is refused, and the tenant moves out.
 *
 * The rows it adds to the Tenants tab STAY in the test copy (the move-out date closes them, but they are not
 * deleted), and the first run creates the Tenants tab there. Logging a new tenant closes every current p5
 * tenancy, as the app does for any new tenant, so a current p5 tenancy that was already in the test copy gets
 * a move-out date too. A run that stopped part-way can leave an open "Verify Tenant" tenancy behind; the next
 * run moves it out first (and says so), so the script can be run again and again.
 *
 * Before it can run, the test copy's Schedule tab must already have a row for 2040-04 with no
 * payment for portion p5. New month rows can only be added in order, so the script cannot create
 * that row itself. It checks this first, and stops with an explanation before writing anything
 * when the row is missing or p5 already has a payment in it.
 */
import {
  sameTenantName,
  type Tenancy,
  type TenancyFields,
  type TenancySummary,
} from "@/lib/domain/tenancy";
import { isValidIsoDay } from "@/lib/domain/year-month";
import { AppError } from "@/lib/errors";
import { readEnv } from "@/lib/server/env";
import { colLetter } from "@/lib/sheets/a1";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { readMonthRowsReadOnly, testCopyProblem } from "@/lib/sheets/recon";
import { columnsOf, parseSchedule } from "@/lib/sheets/schedule";
import {
  getMonthView,
  logPayment,
  readActivity,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { readSettings } from "@/lib/sheets/settings-store";
import type { WriteStamp } from "@/lib/sheets/tenancy-writes";
import { getPortionTenants, moveOutTenancy, saveTenancy } from "@/lib/sheets/tenancy-service";
import { readTenancies } from "@/lib/sheets/tenants-store";

const MONTH = { year: 2040, month: 4 };
const PORTION = "p5";
const TENANT = "Verify Tenant";
const WHO = "verify@example.com";

const TENANCY: TenancyFields = {
  moveIn: "2040-04-01",
  agreementEnd: "2041-03-31",
  advance: 5000,
  advanceDate: "2040-04-01",
  phone: "9000000000",
  notes: "",
};
const EDITED_NOTES = "Edited by the test-copy check";
const STALE_NOTES = "Written from a stale screen";
const MOVE_OUT = "2040-04-30";

/** Set just before the first write, so a failure can say that the test copy may need tidying. */
let startedWriting = false;

/** A stamp that is later than `after` (an ISO time), so a changed row always gets a different Updated at. */
function stampAfter(after?: string): WriteStamp {
  const afterMs = after === undefined ? NaN : Date.parse(after);
  const floor = Number.isNaN(afterMs) ? 0 : afterMs + 1;
  return { now: new Date(Math.max(Date.now(), floor)), updatedBy: WHO };
}

async function main() {
  const env = readEnv(process.env);
  const testSheetId = process.env.TEST_SHEET_ID?.trim();
  if (!testSheetId) {
    throw new Error("Set TEST_SHEET_ID to the id of the TEST COPY of the Sheet.");
  }
  if (testSheetId === env.sheetId) {
    throw new Error("Refusing to run: TEST_SHEET_ID is the same as SHEET_ID (the real Sheet).");
  }

  const gateway = GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, testSheetId);

  // Read-only: the month views below would create missing tabs, so look before anything can write.
  const problem = testCopyProblem(
    await readMonthRowsReadOnly(gateway, env.scheduleTab, env.totalHeader),
    MONTH,
    PORTION,
  );
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
    return;
  }

  const raw: SheetsContext = { gateway, scheduleTab: env.scheduleTab, totalHeader: env.totalHeader };
  const ctx = withSnapshotCache({ ...raw });
  const options = { now: new Date(), loggedBy: WHO };

  let failures = 0;
  function check(label: string, ok: boolean, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures += 1;
  }

  async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
    const started = Date.now();
    const value = await run();
    return [value, Date.now() - started];
  }

  async function rawCell(col: "tenant" | "count" | "amount"): Promise<unknown> {
    const portions = await readSettings(gateway);
    const values = await gateway.getValues(env.scheduleTab, "A1:ZZ", "UNFORMATTED_VALUE");
    const { layout, rows } = parseSchedule(values, portions, env.totalHeader);
    const row = rows.find((r) => r.month.year === MONTH.year && r.month.month === MONTH.month);
    if (!row) throw new Error("The test copy has no row for 2040-04.");
    const a1 = `${colLetter(columnsOf(layout, PORTION)[col])}${row.rowNumber}`;
    const cells = await gateway.getValues(env.scheduleTab, a1, "UNFORMATTED_VALUE");
    return cells[0]?.[0];
  }

  /** The only tenancies this script may change: "Verify Tenant" of p5. */
  const isOwn = (t: Tenancy) => t.portionId === PORTION && sameTenantName(t.tenant, TENANT);

  /** One row of the Tenants tab, read straight from the Sheet (never from the cache). */
  async function storedTenancy(id: string): Promise<Tenancy> {
    const found = (await readTenancies(gateway)).findLast((t) => t.id === id);
    if (!found) throw new Error(`The Tenants tab has no row with the id ${id}.`);
    if (!isOwn(found)) throw new Error(`Row ${found.rowNumber} of the Tenants tab is not a "${TENANT}" row of ${PORTION}.`);
    return found;
  }

  /**
   * An earlier run can leave an open "Verify Tenant" tenancy for p5 behind. A new tenant with the same name
   * would then be refused as a duplicate (the payment would save but not its tenancy), so it is moved out first.
   * Only an open "Verify Tenant" tenancy of p5 is ever touched here.
   */
  async function moveOutLeftovers(): Promise<void> {
    for (let round = 0; round < 10; round++) {
      const view = await getPortionTenants(raw, PORTION);
      const open = view.current ?? view.mismatched;
      if (!open) return;
      if (!isOwn(open)) {
        console.log(
          `NOTE  ${PORTION} has a current tenancy of another tenant (Tenants row ${open.rowNumber}). Logging the new tenant closes it, as it does in the app.`,
        );
        return;
      }
      console.log(
        `NOTE  an earlier run left a current "${TENANT}" tenancy for ${PORTION} (Tenants row ${open.rowNumber}). Moving it out before this run creates its own.`,
      );
      await moveOutTenancy(
        ctx,
        {
          id: open.id,
          expectedUpdatedAt: open.updatedAt,
          // On its own move-in day, which is never before it; a move-in typed by hand that is not a date falls back.
          moveOut: isValidIsoDay(open.moveIn) ? open.moveIn : TENANCY.moveIn,
        },
        stampAfter(open.updatedAt),
      );
    }
    throw new Error(`A current "${TENANT}" tenancy for ${PORTION} is still there after 10 tries. Fix the Tenants tab by hand.`);
  }

  /** Edit, a stale save and move-out of the tenancy that logging the payment created. */
  async function checkTenancyLifecycle(created: TenancySummary): Promise<void> {
    const before = await storedTenancy(created.id);
    check(
      "the Tenants row holds the details that were entered, current, written by the checker",
      before.portionId === PORTION &&
        before.tenant === TENANT &&
        before.moveIn === TENANCY.moveIn &&
        before.agreementEnd === TENANCY.agreementEnd &&
        before.advance === 5000 &&
        before.advanceDate === TENANCY.advanceDate &&
        before.advanceStatus === "Held" &&
        before.phone === TENANCY.phone &&
        before.moveOut === "" &&
        before.updatedBy === WHO,
    );

    const edited = (
      await saveTenancy(
        ctx,
        { portionId: PORTION, tenant: TENANT, id: created.id, expectedUpdatedAt: created.updatedAt, fields: { ...TENANCY, notes: EDITED_NOTES } },
        stampAfter(created.updatedAt),
      )
    ).tenancy;
    const afterEdit = await storedTenancy(created.id);
    check(
      "editing the tenancy changes its notes and its updated-at",
      afterEdit.notes === EDITED_NOTES &&
        afterEdit.updatedAt === edited.updatedAt &&
        afterEdit.updatedAt !== created.updatedAt,
      `${created.updatedAt} then ${afterEdit.updatedAt}`,
    );
    check(
      "the edit left the other columns as they were",
      afterEdit.phone === before.phone &&
        afterEdit.advance === before.advance &&
        afterEdit.advanceStatus === before.advanceStatus &&
        afterEdit.moveIn === before.moveIn &&
        afterEdit.agreementEnd === before.agreementEnd,
    );

    // The screen that still shows the OLD updated-at must be refused and must write nothing.
    let refusedAsConflict = false;
    try {
      await saveTenancy(
        ctx,
        { portionId: PORTION, tenant: TENANT, id: created.id, expectedUpdatedAt: created.updatedAt, fields: { ...TENANCY, notes: STALE_NOTES } },
        stampAfter(edited.updatedAt),
      );
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "conflict") throw error;
      refusedAsConflict = true;
    }
    check("a second save with the old updated-at is refused as a conflict", refusedAsConflict);
    const afterStale = await storedTenancy(created.id);
    check(
      "the refused save wrote nothing",
      afterStale.notes === EDITED_NOTES && afterStale.updatedAt === afterEdit.updatedAt,
    );

    // From what the Sheet holds now, so a stale save that slipped through cannot also make the move-out fail.
    await moveOutTenancy(
      ctx,
      { id: created.id, expectedUpdatedAt: afterStale.updatedAt, moveOut: MOVE_OUT, advanceStatus: "Refunded", refund: 5000 },
      stampAfter(afterStale.updatedAt),
    );
    const tenants = await getPortionTenants(ctx, PORTION);
    const moved = tenants.past.find((t) => t.id === created.id);
    check(
      "after the move-out the tenancy is a past one, Refunded 5000, and none is current",
      moved !== undefined &&
        moved.moveOut === MOVE_OUT &&
        moved.advanceStatus === "Refunded" &&
        moved.refund === 5000 &&
        tenants.current === null,
      `current: ${tenants.current ? tenants.current.tenant : "none"}`,
    );
  }

  const [first, firstMs] = await timed(() => getMonthView(ctx, MONTH));
  check(
    "2040-04 starts with no payment for p5",
    first.cards.find((c) => c.portionId === PORTION)?.status !== "paid",
  );
  if (failures > 0) {
    throw new Error("The test copy's 2040-04 row is not empty for p5. Aborting before writing.");
  }

  const [, cachedMs] = await timed(() => getMonthView(ctx, { year: 2040, month: 3 }));
  check(
    "a second month view comes from the cache",
    cachedMs < firstMs / 2 || cachedMs < 20,
    `${firstMs} ms then ${cachedMs} ms`,
  );

  // Everything above only read (the first read may have created the Tenants tab). From here on it writes.
  startedWriting = true;
  await moveOutLeftovers();

  const logged = await logPayment(
    ctx,
    {
      month: MONTH,
      portionId: PORTION,
      amount: 1111,
      dateReceived: "2040-04-01",
      newTenantName: TENANT,
      tenancy: TENANCY,
    },
    options,
  );
  let card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
  check("logging shows the payment", card.status === "paid" && card.entry?.amount === 1111);
  check(
    "logging the new tenant wrote the tenancy details",
    logged.tenancyWritten === true,
    `tenancyWritten: ${String(logged.tenancyWritten)}`,
  );
  const created = card.tenancy;
  check(
    "the card shows the tenancy with its advance",
    created !== null &&
      created.advance === 5000 &&
      created.advanceStatus === "Held" &&
      created.moveIn === TENANCY.moveIn &&
      created.agreementEnd === TENANCY.agreementEnd &&
      created.phone === TENANCY.phone,
    created ? `advance ${String(created.advance)}, ${String(created.advanceStatus)}` : "no tenancy on the card",
  );

  await logPayment(
    ctx,
    { month: MONTH, portionId: PORTION, amount: 2222, dateReceived: "2040-04-01", overwrite: true },
    options,
  );
  card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
  check("editing changes the amount", card.entry?.amount === 2222);

  if (created) {
    await checkTenancyLifecycle(created);
  } else {
    check("the tenancy edit, stale save and move-out steps could run", false, "skipped: the card has no tenancy");
  }

  await undoPayment(
    ctx,
    { month: MONTH, portionId: PORTION, expected: { tenant: TENANT, count: 1, amount: 2222 } },
    options,
  );
  card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
  check("undo returns the card to not paid", card.status !== "paid");
  for (const col of ["tenant", "count", "amount"] as const) {
    const value = await rawCell(col);
    check(`undo left the ${col} cell blank`, value === undefined || value === "", JSON.stringify(value));
  }

  const activity = await readActivity(raw, 3);
  check(
    "Activity lists Undone, Edited, Logged by the checker, newest first (tenancy changes add no log rows)",
    activity.map((a) => a.action).join(",") === "Undone,Edited,Logged" &&
      activity.every((a) => a.loggedBy === WHO),
    activity.map((a) => `${a.action}:${a.loggedBy}`).join(" "),
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  if (startedWriting) {
    console.error(
      `The test copy may still hold the 2040-04 payment for ${PORTION}. Clear that portion's Tenant, Count and Amount cells in its 2040-04 row before running again. An open "${TENANT}" tenancy in the Tenants tab is moved out automatically by the next run.`,
    );
  }
  process.exitCode = 1;
});
