import { requireUser } from "@/lib/server/auth-guard";
import { getSheetsContext } from "@/lib/server/context";
import { handle, parseJson } from "@/lib/server/http";
import { settingsBody } from "@/lib/server/schemas";
import { saveSettings } from "@/lib/sheets/service";

export async function PUT(request: Request) {
  return handle(async () => {
    await requireUser();
    const { portions } = await parseJson(request, settingsBody);
    return { portions: await saveSettings(getSheetsContext(), portions) };
  });
}
