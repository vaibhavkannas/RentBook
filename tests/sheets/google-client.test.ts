import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { sheets as createSheets } from "@googleapis/sheets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { GoogleSheetsGateway, SHEETS_CLIENT_OPTIONS } from "@/lib/sheets/google-gateway";

// The real Google client talking to a server on this machine, so the settings that decide how it retries and
// when it gives up are tested as they really behave, not only as they are written down. Nothing here reaches Google.
vi.mock("@googleapis/sheets", async (importOriginal) => {
  const original = await importOriginal<typeof import("@googleapis/sheets")>();
  // Called as a method of the real module, as the library expects: it reads its own settings from `this`.
  // The library takes the version out of the object it is given, so it is given a copy and the call stays as made.
  const sheets = vi.fn((options: Parameters<typeof original.sheets>[0]) => original.sheets({ ...options }));
  return { ...original, sheets };
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

async function localGoogle(handler: Handler) {
  const requests: { method: string; url: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method ?? "", url: request.url ?? "" });
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const rootUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return { requests, rootUrl };
}

const answer = (status: number, body: unknown): Handler => (_request, response) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
};

const failing = (status: number) => answer(status, { error: { code: status, message: "Backend Error" } });

/** A gateway on the real client, with the app's own client settings (and optionally a shorter timeout). */
function gatewayOn(rootUrl: string, options: { timeout?: number } = {}) {
  const api = createSheets({ version: "v4", rootUrl, ...SHEETS_CLIENT_OPTIONS, ...options });
  return new GoogleSheetsGateway(api, "sheet-id", undefined, { backoffMs: () => 0 });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("the Google client settings", () => {
  it("allow a request 10 seconds and switch the client's own retrying off", () => {
    expect(SHEETS_CLIENT_OPTIONS).toEqual({ timeout: 10_000, retryConfig: { retry: 0, noResponseRetries: 0 } });
  });

  it("are the ones the service account gateway is created with", () => {
    const key = JSON.stringify({
      client_email: "bot@proj.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    });
    vi.mocked(createSheets).mockClear();
    GoogleSheetsGateway.fromServiceAccount(key, "id");
    expect(createSheets).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v4", timeout: 10_000, retryConfig: { retry: 0, noResponseRetries: 0 } }),
    );
  });
});

describe("against a server that fails", () => {
  it("a read is tried 3 times in all: the gateway's own count, not the client's", async () => {
    const { requests, rootUrl } = await localGoogle(failing(503));
    const error = await gatewayOn(rootUrl).getValues("Schedule", "A1", "FORMULA").then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe("unavailable");
  });

  it("a batched read is one request, tried 3 times in all", async () => {
    const { requests, rootUrl } = await localGoogle(failing(429));
    const error = await gatewayOn(rootUrl)
      .getManyValues([{ tab: "A", a1: "A1" }, { tab: "B", a1: "A1" }], "FORMULA")
      .then(
        () => null,
        (e: unknown) => e as AppError,
      );
    expect(requests).toHaveLength(3);
    expect(requests[0].url).toContain("/values:batchGet");
    expect(error!.code).toBe("rate-limited");
  });

  it("an append is sent once, however Google fails", async () => {
    for (const status of [503, 429, 500]) {
      const { requests, rootUrl } = await localGoogle(failing(status));
      await expect(gatewayOn(rootUrl).appendRow("Payments Log", ["x"])).rejects.toBeInstanceOf(AppError);
      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe("POST");
    }
  });

  it("a structural change (adding a tab, cloning a row) is sent once", async () => {
    const { requests, rootUrl } = await localGoogle(failing(503));
    await expect(gatewayOn(rootUrl).addTab("Settings")).rejects.toBeInstanceOf(AppError);
    expect(requests).toHaveLength(1);
  });

  it("a write that can be repeated is tried 3 times in all", async () => {
    const { requests, rootUrl } = await localGoogle(failing(500));
    await expect(
      gatewayOn(rootUrl).updateValues([{ tab: "Schedule", a1: "A1", values: [["x"]] }]),
    ).rejects.toBeInstanceOf(AppError);
    expect(requests).toHaveLength(3);
  });

  it("a read that works on the third try gives its answer", async () => {
    let count = 0;
    const { requests, rootUrl } = await localGoogle((request, response) => {
      count += 1;
      if (count < 3) return failing(503)(request, response);
      return answer(200, { values: [["ok"]] })(request, response);
    });
    expect(await gatewayOn(rootUrl).getValues("Schedule", "A1", "FORMULA")).toEqual([["ok"]]);
    expect(requests).toHaveLength(3);
  });

  it("a request that gets no answer is given up on at the timeout and not tried again", async () => {
    const { requests, rootUrl } = await localGoogle(() => {
      // never answers
    });
    const started = Date.now();
    const error = await gatewayOn(rootUrl, { timeout: 150 }).getValues("Schedule", "A1", "FORMULA").then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requests).toHaveLength(1);
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe("unavailable");
  });

  it("a connection that cannot be made is unavailable, without a retry storm", async () => {
    const { rootUrl } = await localGoogle(answer(200, {}));
    const closed = rootUrl.replace(/:\d+\//, ":1/");
    const error = await gatewayOn(closed).getValues("Schedule", "A1", "FORMULA").then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error!.code).toBe("unavailable");
  });
});
