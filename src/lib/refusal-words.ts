/** The words of each refusal (30 October 2026, batch 2 section 3.4): the "Not here" page and the owner's list. Pure. */
export const REFUSAL_WORDS: Record<string, { title: string; text: string; next?: string }> = {
  missing: { title: "Not here", text: "This page does not exist, or the record was removed. If you typed the address, check it." },
  booking_cancelled: { title: "This booking was cancelled", text: "It is no longer in the calendar.", next: "Open the calendar" },
  car_left: { title: "This car has left the workshop", text: "The visit is closed. Its history is on the car's page.", next: "Open the car's history" },
  no_customer_access: { title: "You don't have access to customer details", text: "Customer details are for the owner, the service advisors and accounts. The car's own pages are open to you." },
  no_permission: { title: "You don't have access to this page", text: "Your role cannot open it. Ask the owner if you need it." },
  not_on_car: { title: "This car is not one of yours", text: "It is not assigned to you or your team. Your own cars are under My jobs.", next: "My jobs" },
  estimate_gone: { title: "This estimate is no longer open", text: "It was deleted, or carried over to the car's job at gate-in.", next: "Open the car's history" },
};

export const refusalWords = (code: string | null | undefined) => REFUSAL_WORDS[code ?? ""] ?? REFUSAL_WORDS.missing;
