/**
 * A form that opens when a button is pressed (the move-out form, the tenancy edit form) cannot open in a render on the
 * server, which runs no events. renderOpen renders one open: the first useState of a component, which is its `open` flag
 * in both of those forms, is answered with true for that one render.
 *
 * The test file mocks React with this module's `mockReact`:
 *
 *   vi.mock("react", async (importOriginal) => (await import("../support/render-open")).mockReact(await importOriginal()));
 */

const state = { openFirst: false, calls: 0 };

/** `actual` is the real React; the result is React with a useState that renderOpen can answer for. */
export function mockReact<T extends { useState: unknown }>(actual: T): T {
  const realUseState = actual.useState as (initial: unknown) => unknown;
  return {
    ...actual,
    useState: (initial: unknown) => {
      state.calls += 1;
      if (state.openFirst && state.calls === 1) return [true, () => {}];
      return realUseState(initial);
    },
  };
}

export function renderOpen(render: () => string): string {
  state.openFirst = true;
  state.calls = 0;
  try {
    return render();
  } finally {
    state.openFirst = false;
  }
}
