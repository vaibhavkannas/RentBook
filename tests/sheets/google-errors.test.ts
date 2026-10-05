import { describe, expect, it } from "vitest";
import { AppError, validation } from "@/lib/errors";
import { translateGoogleError } from "@/lib/sheets/google-errors";

const EMAIL = "rentbook@project.iam.gserviceaccount.com";

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

  it("names the service account when access is denied", () => {
    const error = translateGoogleError({ status: 403, message: "forbidden" }, EMAIL) as AppError;
    expect(error.message).toContain(EMAIL);
  });

  it("reads the status from response.status or a string code", () => {
    expect((translateGoogleError({ response: { status: 404 } }) as AppError).message).toMatch(
      /SHEET_ID/,
    );
    expect((translateGoogleError({ code: "429" }) as AppError).message).toMatch(/limiting/);
  });

  it("passes AppErrors and unknown failures through untouched", () => {
    const own = validation("nope");
    expect(translateGoogleError(own)).toBe(own);
    const other = new Error("socket hang up");
    expect(translateGoogleError(other)).toBe(other);
    expect(translateGoogleError("text")).toBe("text");
  });
});
