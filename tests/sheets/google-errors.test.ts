import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AppError, validation } from "@/lib/errors";
import { translateGoogleError } from "@/lib/sheets/google-errors";

const EMAIL = "rentbook@project.iam.gserviceaccount.com";
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789SECRETID";

/** Shaped like a GaxiosError: it carries the request, whose URL holds the Sheet ID. */
function googleError(fields: Record<string, unknown>) {
  return Object.assign(new Error(String(fields.message ?? "request failed")), {
    config: {
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Schedule`,
      body: JSON.stringify({ values: [["Tenant Name"]] }),
    },
    ...fields,
  });
}

describe("translateGoogleError", () => {
  it("explains the .xlsx case", () => {
    const error = translateGoogleError(
      { code: 400, message: "This operation is not supported for this document" },
      EMAIL,
    ) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("config");
    expect(error.message).toMatch(/Save as Google Sheets/);
  });

  it("names the service account and quotes Google when access is denied", () => {
    const error = translateGoogleError(
      { status: 403, message: "The caller does not have permission" },
      EMAIL,
    ) as AppError;
    expect(error.message).toContain(EMAIL);
    expect(error.message).toContain("The caller does not have permission");
    expect(error.message).toMatch(/Share the Sheet/);
  });

  it("tells the owner to enable the Sheets API when that is why access was denied", () => {
    const error = translateGoogleError(
      {
        status: 403,
        message:
          "Google Sheets API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=123456",
      },
      EMAIL,
    ) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toMatch(/enable the Google Sheets API/i);
    expect(error.message).not.toMatch(/Share the Sheet/);
    expect(error.message).not.toContain("123456");
  });

  it("reads the status from response.status or a string code", () => {
    expect((translateGoogleError({ response: { status: 404 } }) as AppError).message).toMatch(
      /SHEET_ID/,
    );
    expect((translateGoogleError({ code: "429" }) as AppError).message).toMatch(/limiting/);
  });

  it("passes AppErrors and non-Google failures through untouched", () => {
    const own = validation("nope");
    expect(translateGoogleError(own)).toBe(own);
    const other = new Error("socket hang up");
    expect(translateGoogleError(other)).toBe(other);
    expect(translateGoogleError("text")).toBe("text");
  });

  it("replaces an unrecognised Google HTTP error with a plain error that cannot leak the request", () => {
    const original = googleError({ status: 400, code: 400, message: "Invalid value at 'data'" });
    const result = translateGoogleError(original, EMAIL) as Error;
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBe(original);
    expect(result.message).toBe("Google Sheets request failed (HTTP 400): Invalid value at 'data'");
    expect("config" in result).toBe(false);
    expect(inspect(result, { depth: 6 })).not.toContain(SHEET_ID);
    expect(inspect(result, { depth: 6 })).not.toContain("Tenant Name");
  });

  it("does the same for a failure that has no HTTP status and is not a lost connection", () => {
    const original = googleError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", message: "self-signed certificate" });
    const result = translateGoogleError(original) as Error;
    expect(result).not.toBeInstanceOf(AppError);
    expect(result.message).toBe("Google Sheets request failed: self-signed certificate");
    expect(inspect(result, { depth: 6 })).not.toContain(SHEET_ID);
  });

  describe("Google limiting requests, or not responding", () => {
    it("maps a 429 to rate-limited, in plain words", () => {
      const error = translateGoogleError(googleError({ status: 429, message: "Quota exceeded for quota metric" }), EMAIL) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("rate-limited");
      expect(error.message).toBe("Google is limiting requests right now. Wait a minute and try again.");
      expect(error.message).not.toContain("Quota");
    });

    it.each([500, 502, 503, 504])("maps a %i to unavailable, in plain words", (status) => {
      const error = translateGoogleError(googleError({ status, code: status, message: "Backend Error" }), EMAIL) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("Google isn't responding. Try again in a minute.");
    });

    it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "TimeoutError"])(
      "maps a lost connection (%s) to unavailable",
      (code) => {
        const error = translateGoogleError(googleError({ code, message: "request failed" }), EMAIL) as AppError;
        expect(error).toBeInstanceOf(AppError);
        expect(error.code).toBe("unavailable");
        expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
      },
    );

    it("maps a request the client gave up waiting for to unavailable", () => {
      const aborted = googleError({ message: "The operation was aborted.", cause: { name: "AbortError" } });
      expect((translateGoogleError(aborted, EMAIL) as AppError).code).toBe("unavailable");
      const timedOut = googleError({ message: "request failed", cause: { name: "TimeoutError" } });
      expect((translateGoogleError(timedOut, EMAIL) as AppError).code).toBe("unavailable");
    });

    it("maps a failed fetch to unavailable, even when only the cause carries the code", () => {
      expect((translateGoogleError(googleError({ message: "fetch failed" }), EMAIL) as AppError).code).toBe("unavailable");
      const wrapped = googleError({ message: "request failed", cause: { code: "ECONNRESET" } });
      expect((translateGoogleError(wrapped, EMAIL) as AppError).code).toBe("unavailable");
    });

    it("does not call a 4xx, or an error that is not from Google's client, unavailable", () => {
      for (const status of [400, 409, 418]) {
        expect(translateGoogleError(googleError({ status, message: "x" }), EMAIL)).not.toBeInstanceOf(AppError);
      }
      const plain = new Error("something else");
      expect(translateGoogleError(plain, EMAIL)).toBe(plain);
    });
  });

  describe("Google rejecting the service account key", () => {
    const KEY_MESSAGE =
      "Google rejected the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT_JSON.";

    it.each([
      ["a 401", { status: 401, message: "Request had invalid authentication credentials." }],
      ["invalid_grant", { status: 400, code: 400, message: "invalid_grant: Invalid JWT Signature." }],
      ["invalid_client", { status: 401, message: "invalid_client" }],
      ["a token error that names it only in the response", { status: 400, message: "request failed", response: { status: 400, data: { error: "invalid_grant" } } }],
    ])("maps %s to a config error that says what to do", (_name, fields) => {
      const error = translateGoogleError(googleError(fields), EMAIL) as AppError;
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("config");
      expect(error.message).toBe(KEY_MESSAGE);
      expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
    });

    it("leaves 403 and 404 with their own messages", () => {
      expect((translateGoogleError(googleError({ status: 403, message: "nope" }), EMAIL) as AppError).message).toMatch(/Share the Sheet/);
      expect((translateGoogleError(googleError({ status: 404, message: "nope" }), EMAIL) as AppError).message).toMatch(/SHEET_ID/);
    });
  });

  describe("a tab that is gone", () => {
    const MISSING = (tab: string) =>
      `The tab "${tab}" was not found in your Sheet. Restore it from File > Version history or rename it back.`;

    it.each(["Unable to parse range: 'Payments Log'!A1:I", "Requested entity was not found."])(
      "maps a 400 saying %j to a sheet-structure error naming the tab it was asked for",
      (message) => {
        const error = translateGoogleError(googleError({ status: 400, message }), EMAIL, "Payments Log") as AppError;
        expect(error).toBeInstanceOf(AppError);
        expect(error.code).toBe("sheet-structure");
        expect(error.message).toBe(MISSING("Payments Log"));
        expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
      },
    );

    it("reads the status from code or response.status too", () => {
      for (const fields of [{ code: 400 }, { response: { status: 400 } }, { code: "400" }]) {
        const error = translateGoogleError(
          googleError({ ...fields, message: "Unable to parse range: Tenants!A1" }),
          EMAIL,
          "Tenants",
        ) as AppError;
        expect(error.message).toBe(MISSING("Tenants"));
      }
    });

    it("does nothing special when no tab is known, as for listing the tabs", () => {
      const result = translateGoogleError(
        googleError({ status: 400, message: "Unable to parse range: Schedule!A1" }),
        EMAIL,
      ) as Error;
      expect(result).not.toBeInstanceOf(AppError);
      expect(result.message).toBe("Google Sheets request failed (HTTP 400): Unable to parse range: Schedule!A1");
    });

    it("only reacts to a 400", () => {
      expect(
        (translateGoogleError(googleError({ status: 404, message: "Requested entity was not found." }), EMAIL, "Schedule") as AppError)
          .message,
      ).toBe("Google could not find that Sheet. Check SHEET_ID.");
      const serverError = translateGoogleError(
        googleError({ status: 500, message: "Unable to parse range: x" }),
        EMAIL,
        "Schedule",
      ) as AppError;
      expect(serverError.code).toBe("unavailable");
    });

    it("leaves another 400 alone", () => {
      const result = translateGoogleError(
        googleError({ status: 400, message: "Invalid value at 'data'" }),
        EMAIL,
        "Schedule",
      ) as Error;
      expect(result.message).toBe("Google Sheets request failed (HTTP 400): Invalid value at 'data'");
    });
  });

  it("does not leak the request through a recognised error either", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const error = translateGoogleError(
        googleError({ status, message: "Unable to parse range: Schedule!A1" }),
        EMAIL,
      );
      expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
    }
  });
});
