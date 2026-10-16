import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A page that is not found renders for each request, so that it receives that request's nonce: a page built
// ahead of time has no nonce, and its scripts would be blocked by the Content-Security-Policy.

const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("next/server", () => ({ connection }));

import NotFound from "@/app/not-found";

beforeEach(() => connection.mockClear());

describe("not-found page", () => {
  it("waits for a request before it renders", async () => {
    await NotFound();
    expect(connection).toHaveBeenCalledOnce();
  });

  it("says plainly that the page was not found, and links home", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("That page was not found.");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>[^<]*Back to RentBook/);
  });

  it("gives the link a tap target of at least 44px", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b/);
  });
});
