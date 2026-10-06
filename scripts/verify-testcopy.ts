/**
 * Exercises log, edit, undo, Activity and the cache against a TEST COPY of the
 * Sheet, through the real Google API. It refuses to run against the real Sheet.
 *
 *   TEST_SHEET_ID=<id of the test copy> npm run verify:testcopy
 *
 * It writes to the test copy: one payment is logged, edited and undone in the
 * month 2040-04 for portion p5, and three rows are added to its Payments Log.
 *
 * Before it can run, the test copy's Schedule tab must already have a row for 2040-04 with no
 * payment for portion p5. New month rows can only be added in order, so the script cannot create
 * that row itself. It checks this first, and stops with an explanation before writing anything
 * when the row is missing or p5 already has a payment in it.
 */
import { AppError } from "@/lib/errors";
import { readEnv } from "@/lib/server/env";
import { colLetter } from "@/lib/sheets/a1";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { readMonthRowsReadOnly, testCopyProblem } from "@/lib/sheets/recon";
import { parseSchedule } from "@/lib/sheets/schedule";
import {
  getMonthView,
  logPayment,
  readActivity,
  undoPayment,
  withSnapshotCache,
  type SheetsContext,
} from "@/lib/sheets/service";
import { readSettings } from "@/lib/sheets/settings-store";

const MONTH = { year: 2040, month: 4 };
const PORTION = "p5";
const WHO = "verify@example.com";

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
    const a1 = `${colLetter(layout.portionCols[PORTION][col])}${row.rowNumber}`;
    const cells = await gateway.getValues(env.scheduleTab, a1, "UNFORMATTED_VALUE");
    return cells[0]?.[0];
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

  await logPayment(
    ctx,
    { month: MONTH, portionId: PORTION, amount: 1111, dateReceived: "2040-04-01", newTenantName: "Verify Tenant" },
    options,
  );
  let card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
  check("logging shows the payment", card.status === "paid" && card.entry?.amount === 1111);

  await logPayment(
    ctx,
    { month: MONTH, portionId: PORTION, amount: 2222, dateReceived: "2040-04-01", overwrite: true },
    options,
  );
  card = (await getMonthView(ctx, MONTH)).cards.find((c) => c.portionId === PORTION)!;
  check("editing changes the amount", card.entry?.amount === 2222);

  await undoPayment(
    ctx,
    { month: MONTH, portionId: PORTION, expected: { tenant: "Verify Tenant", count: 1, amount: 2222 } },
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
    "Activity lists Undone, Edited, Logged by the checker, newest first",
    activity.map((a) => a.action).join(",") === "Undone,Edited,Logged" &&
      activity.every((a) => a.loggedBy === WHO),
    activity.map((a) => `${a.action}:${a.loggedBy}`).join(" "),
  );

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? error.message : error);
  process.exitCode = 1;
});
