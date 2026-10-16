import { expect, vi, type MockInstance } from "vitest";

/** The three console methods the logger writes to, held back so a test can read what was logged. */
export type LogSpies = {
  info: MockInstance<typeof console.info>;
  warn: MockInstance<typeof console.warn>;
  error: MockInstance<typeof console.error>;
};

/** Replaces console.info, .warn and .error with spies that print nothing. Restore them with `vi.restoreAllMocks()`. */
export function captureLogs(): LogSpies {
  return {
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

/** Every log line a spy received, parsed. Fails when a call was not exactly one string holding one JSON object. */
export function loggedLines(spy: MockInstance<(...args: unknown[]) => void>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((args) => {
    expect(args).toHaveLength(1);
    const [line] = args;
    expect(typeof line).toBe("string");
    expect(String(line)).not.toContain("\n");
    return JSON.parse(String(line)) as Record<string, unknown>;
  });
}
