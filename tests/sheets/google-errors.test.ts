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
      expect(
        (translateGoogleError(googleError({ status: 500, message: "Unable to parse range: x" }), EMAIL, "Schedule") as Error).message,
      ).toBe("Google Sheets request failed (HTTP 500): Unable to parse range: x");
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
    for (const status of [400, 403, 404, 429]) {
      const error = translateGoogleError(
        googleError({ status, message: "Unable to parse range: Schedule!A1" }),
        EMAIL,
      );
      expect(inspect(error, { depth: 6 })).not.toContain(SHEET_ID);
    }
  });
});
