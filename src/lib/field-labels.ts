/**
 * What a field is called in a message a person reads. A request names its fields the way the code does (`dateReceived`,
 * `moveIn`); the person knows them by what the screen calls them. Pure on purpose: server and client code may both use it.
 */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  amount: "Amount",
  dateReceived: "Date received",
  newTenantName: "Tenant name",
  tenant: "Tenant name",
  month: "Month",
  portionId: "Portion",
  phone: "Phone",
  moveIn: "Move-in date",
  agreementEnd: "Agreement end",
  advance: "Advance",
  advanceDate: "Advance date",
  notes: "Notes",
  moveOut: "Move-out date",
  refund: "Refund",
  deductions: "Deductions",
  name: "Portion name",
  cycleLength: "Payments per cycle",
  hikePercent: "Hike",
};

/**
 * What is said of a field that has a label, when the only thing known is that its value is not valid. It names the field
 * in a sentence of its own, so it reads the same for a label that is singular ("Phone") and one that is plural ("Notes").
 */
export const invalidFieldMessage = (label: string): string => `The ${label.toLowerCase()} field isn't valid.`;

/**
 * The label of the last part of a path into a request (["fields", "phone"], ["portions", 0, "name"]), or null when it
 * ends at a position in a list, is empty, or is a field the screen has no name for. Only the last part counts: what
 * a field is called does not depend on where it sits.
 */
export function fieldLabel(path: ReadonlyArray<PropertyKey>): string | null {
  const last = path[path.length - 1];
  if (typeof last !== "string") return null;
  // hasOwn: "constructor" or "toString" in a request must not find a function on Object.prototype.
  return Object.hasOwn(FIELD_LABELS, last) ? FIELD_LABELS[last] : null;
}
