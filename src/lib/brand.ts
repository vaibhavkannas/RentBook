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
    accent: "#0f766e",
    accentInk: "#ffffff",
    background: "#f3f5f7",
    accentDark: "#3cc3b4",
    backgroundDark: "#0c1218",
  },
} as const;

export const getBrand = () => BRAND;
