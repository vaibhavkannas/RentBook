import type { SheetsGateway } from "./gateway";

/**
 * Adds a tab. Returns true when this call added it, false when it was there already.
 *
 * Two server instances that start together can both see a tab missing and both add it; the one that loses is
 * told the title is taken. Whatever the reason an add fails, the tabs are listed again: if the tab is there
 * now, the failure was that race and the caller carries on with the tab as it is, otherwise it was a real
 * failure and is passed on.
 */
export async function addTabIfMissing(gateway: SheetsGateway, title: string): Promise<boolean> {
  try {
    await gateway.addTab(title);
    return true;
  } catch (error) {
    if ((await gateway.listTabs()).includes(title)) return false;
    throw error;
  }
}
