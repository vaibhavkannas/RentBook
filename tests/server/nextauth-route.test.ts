import { describe, expect, it, vi } from "vitest";

const handlers = vi.hoisted(() => ({
  GET: vi.fn(async () => new Response("get")),
  POST: vi.fn(async () => new Response("post")),
}));
vi.mock("@/auth", () => ({ handlers }));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

// Auth.js's own routes get form posts from the sign-in and sign-out buttons and redirects back from Google. The
// JSON and same-origin checks of our API routes must not stand in their way.
describe("the sign-in routes", () => {
  it("are Auth.js's own handlers, with none of our request checks in front of them", async () => {
    expect(GET).toBe(handlers.GET);
    expect(POST).toBe(handlers.POST);
  });

  it("take a form post and a request from another site without our refusals", async () => {
    const form = new Request("http://localhost/api/auth/signin/google", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "cross-site", Origin: "https://accounts.google.com" },
      body: "csrfToken=x",
    });
    const res = await POST(form as never);
    expect(res.status).toBe(200);
    expect(handlers.POST).toHaveBeenCalledOnce();
  });
});
