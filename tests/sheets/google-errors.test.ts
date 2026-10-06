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
    const original = googleError({ status: 500, code: 500, message: "Internal error encountered." });
    const result = translateGoogleError(original, EMAIL) as Error;
    expect(result).toBeInstanceOf(Error);
    expect(result).not.toBe(original);
    expect(result.message).toBe("Google Sheets request failed (HTTP 500): Internal error encountered.");
    expect("config" in result).toBe(false);
    expect(inspect(result, { depth: 6 })).not.toContain(SHEET_ID);
    expect(inspect(result, { depth: 6 })).not.toContain("Tenant Name");
  });

  it("does the same for a network failure that has no HTTP status", () => {
    const original = googleError({ code: "ECONNRESET", message: "socket hang up" });
    const result = translateGoogleError(original) as Error;
    expect(result.message).toBe("Google Sheets request failed: socket hang up");
    expect(inspect(result, { depth: 6 })).not.toContain(SHEET_ID);
  });

  it("does not leak the request through a recognised error either", () => {
    for (const status of [400, 403, 404, 429]) {
      const error = translateGoogleError(
        googleError({ status, message: "Unable to parse range: Schedule!A1" }),
        EMAIL,
      );
      expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
    }
  });
});
