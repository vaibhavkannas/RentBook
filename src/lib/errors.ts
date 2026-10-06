export class AppError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "validation"
      | "conflict"
      | "sheet-structure"
      | "config",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError("unauthorized", "Sign in with the allowed Google account.");

export const forbidden = () => new AppError("forbidden", "Only the owner can do that.");

export const validation = (message: string) => new AppError("validation", message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError("conflict", message, details);

export const sheetStructure = (message: string) =>
  new AppError("sheet-structure", message);

export const configError = (message: string) => new AppError("config", message);
