/**
 * Read-only check of your real Google Sheet. Prints what RentBook sees and
 * lists anything it cannot handle. Never writes to the Sheet.
 *
 *   npm run recon
 *
 * The script runs with tsx --conditions=react-server (see package.json): the code it imports starts with
 * import "server-only", which throws outside a Next server build unless that condition is set.
 */
import { AppError } from "@/lib/errors";
import { readEnv } from "@/lib/server/env";
import { GoogleSheetsGateway } from "@/lib/sheets/google-gateway";
import { describeSheet } from "@/lib/sheets/recon";

async function main() {
  const env = readEnv(process.env);
  const gateway = GoogleSheetsGateway.fromServiceAccount(env.serviceAccountJson, env.sheetId);
  const report = await describeSheet(gateway, env.scheduleTab, env.totalHeader);
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length > 0) {
    console.error(`\n${report.problems.length} problem(s) found. See "problems" above.`);
    process.exitCode = 1;
  } else {
    console.log("\nNo problems found. RentBook can work with this Sheet.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof AppError ? error.message : error);
  process.exitCode = 1;
});
