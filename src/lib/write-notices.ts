/**
 * What a save that was answered after its sheet was gone still has to tell the owner (the Payments Log retry, the tenancy
 * warning, a duplicate, a failure). They live outside any screen, in the root layout's host, so moving to another tab or opening
 * another sheet cannot lose them. Pure and small, so it can be tested.
 */
export type WriteNotice = { text: string; retryToken?: string };
export type StoredNotice = WriteNotice & { id: number };

export function createNoticeStore() {
  let notices: StoredNotice[] = [];
  let next = 0;
  const listeners = new Set<() => void>();
  const set = (value: StoredNotice[]) => {
    notices = value;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => notices,
    add(notice: WriteNotice): number {
      next += 1;
      set([...notices, { ...notice, id: next }]);
      return next;
    },
    update(id: number, change: Partial<WriteNotice>) {
      set(notices.map((n) => (n.id === id ? { ...n, ...change } : n)));
    },
    remove(id: number) {
      set(notices.filter((n) => n.id !== id));
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** The one store of the app. */
export const writeNotices = createNoticeStore();
