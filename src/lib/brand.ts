/**
 * The product's name, wording and colours, in one place. Wave 3 replaces the source of these values with the
 * Config tab; callers must go through this module (`BRAND` or `getBrand()`) and never write the name themselves.
 * Pure on purpose: server and client code may both import it.
 */
export const BRAND = {
  name: "RentBook",
  shortName: "RentBook",
  tagline: "Rent receipts, straight into your own Google Sheet.",
  description: "Record monthly rent receipts into your Google Sheet.",
  colors: {
    accent: "#1f5f4a",
    accentInk: "#ffffff",
    background: "#f6f5f1",
    accentDark: "#6fc2a0",
    backgroundDark: "#121311",
  },
} as const;

export const getBrand = () => BRAND;
