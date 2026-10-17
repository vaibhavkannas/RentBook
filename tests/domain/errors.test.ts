import { describe, expect, it } from "vitest";
import {
  crossOriginRequest,
  PAGE_OUT_OF_DATE_MESSAGE,
  unknownPortion,
  unsupportedMediaType,
  validation,
} from "@/lib/errors";

describe("validation", () => {
  it("is a validation error with the message, and no details when it names no field", () => {
    const error = validation("That month isn't valid.");
    expect(error.code).toBe("validation");
    expect(error.message).toBe("That month isn't valid.");
    expect(error.details).toBeUndefined();
  });

  it("carries the field it is about in its details, so a screen can show the message beside that field", () => {
    const error = validation("Move-out date cannot be before the move-in date.", "moveOut");
    expect(error.details).toEqual({ field: "moveOut" });
    expect(error.message).toBe("Move-out date cannot be before the move-in date.");
  });

  it("keeps the path of a field inside a list or a group as it was given", () => {
    expect(validation("x", "portions.0.name").details).toEqual({ field: "portions.0.name" });
  });
});

describe("unsupportedMediaType", () => {
  it("tells the person to reload, without saying what JSON is, and keeps its 415", () => {
    const error = unsupportedMediaType();
    expect(error.status).toBe(415);
    expect(error.code).toBe("validation");
    expect(error.message).toBe("That request couldn't be read. Switch to another tab and back, then try again.");
  });
});

describe("the messages that tell a person to bring the screen up to date", () => {
  it("say to switch to another tab and back, which loads the screen again, and never to refresh or reload", () => {
    const hint = "Switch to another tab and back, then try again.";
    expect(PAGE_OUT_OF_DATE_MESSAGE).toBe(`This page is out of date. ${hint}`);
    expect(unknownPortion().message).toBe(`That portion isn't in your Settings any more. ${hint}`);
    expect(crossOriginRequest().message).toBe(`That request didn't come from RentBook's own page. ${hint}`);
    expect(unsupportedMediaType().message).toBe(`That request couldn't be read. ${hint}`);
  });
});
