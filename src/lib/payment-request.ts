import type { TenancyFields } from "@/lib/domain/tenancy";
import type { PortionEntry } from "@/lib/domain/types";

export type PaymentRequestInput = {
  mode: "log" | "edit" | "new-tenant";
  monthKey: string;
  portionId: string;
  amount: number;
  dateReceived: string;
  tenantName: string;
  /** The person confirmed "Replace amount" after a duplicate warning. */
  confirmedReplace: boolean;
  /** The paid card's entry as it was when the Edit sheet opened. Never read from a refreshed card. */
  seenEntry: PortionEntry | undefined;
  /** Details of the new tenant (the "Tenancy details" part of the new tenant sheet). Only used in the new-tenant mode. */
  tenancy?: TenancyFields;
};

export type PaymentRequest =
  | {
      ok: true;
      body: {
        month: string;
        portionId: string;
        amount: number;
        dateReceived: string;
        newTenantName: string | undefined;
        overwrite: true | undefined;
        expected: PortionEntry | undefined;
        /** Only when a new tenant is named and at least one tenancy field is filled in. */
        tenancy: TenancyFields | undefined;
      };
    }
  | { ok: false; message: string };

/** Whether the person filled in at least one tenancy field. Spaces alone do not count. */
function hasTenancyDetails(tenancy: TenancyFields | undefined): tenancy is TenancyFields {
  if (!tenancy) return false;
  const texts = [tenancy.phone, tenancy.moveIn, tenancy.agreementEnd, tenancy.advanceDate, tenancy.notes];
  return texts.some((text) => (text ?? "").trim() !== "") || typeof tenancy.advance === "number";
}

/**
 * The body of POST /api/payments. An edit always says which entry it was shown, so the server
 * can refuse it if someone else has since changed or undone that payment.
 */
export function buildPaymentRequest(input: PaymentRequestInput): PaymentRequest {
  const editing = input.mode === "edit";
  if (editing && !input.seenEntry) {
    return {
      ok: false,
      message: "This payment is no longer recorded. Close this and refresh the page.",
    };
  }
  return {
    ok: true,
    body: {
      month: input.monthKey,
      portionId: input.portionId,
      amount: input.amount,
      dateReceived: input.dateReceived,
      newTenantName: input.mode === "new-tenant" ? input.tenantName : undefined,
      overwrite: input.confirmedReplace || editing ? true : undefined,
      expected: editing ? input.seenEntry : undefined,
      tenancy: input.mode === "new-tenant" && hasTenancyDetails(input.tenancy) ? input.tenancy : undefined,
    },
  };
}
