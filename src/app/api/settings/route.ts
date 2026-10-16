import { requireOwner } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { markWritten } from "@/lib/server/freshness";
import { handle, parseBody, readJsonBody } from "@/lib/server/http";
import { settingsBody } from "@/lib/server/schemas";
import { saveSettings } from "@/lib/sheets/service";

// A Google call gives up after 10 seconds; the whole request is cut off after 15.
export const maxDuration = 15;

export async function PUT(request: Request) {
  return handle(async () => {
    // Before the sign-in check: from the app's own page, as JSON, and no more than 32 KB.
    const raw = await readJsonBody(request);
    const viewer = await requireOwner();
    const { portions } = parseBody(raw, settingsBody);
    const saved = await saveSettings(getSheetsContext(), portions);
    await markWritten(viewer.email);
    return { portions: saved };
  });
}
