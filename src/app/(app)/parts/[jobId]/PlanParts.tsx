"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";

export type PlanPart = { id: string; description: string; quantity: number; availability: string | null; delivery_date: string | null; order_status: string; expected_date: string | null; received: boolean; /** Days until the ordered part arrives, from the delivery date. */ days: string };

/** One thin row per approved part: "In stock" or "To order" with the days, one tap each. */
export function PlanPartRow({ part, action }: { part: PlanPart; action: (formData: FormData) => void }) {
  const [days, setDays] = useState(part.days);
  const locked = part.received || part.order_status === "ordered" || part.order_status === "partly_received";
  return (
    <form action={action} className="py-2 flex flex-wrap items-center gap-2">
      <span className="flex-1 min-w-48 font-semibold">{part.description} <span className="text-muted font-normal">× {part.quantity}</span></span>
      {locked ? (
        <span className="text-xs font-semibold text-muted">{part.received ? "Here" : `Ordered${part.expected_date ? `, expected ${part.expected_date}` : ""}`}</span>
      ) : (
        <>
          <Button type="submit" name="choice" value="in_stock" size="md" tone={part.availability === "in_stock" ? "primary" : "secondary"}>In stock</Button>
          <span className="inline-flex items-center gap-1">
            <Button type="submit" name="choice" value="to_order" size="md" tone={part.availability === "to_order" && part.delivery_date ? "primary" : "secondary"}>To order</Button>
            <Input name="days" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="days" className="w-20" aria-label="Days until it arrives" />
          </span>
          {part.availability === "to_order" && part.delivery_date ? <span className="text-xs text-muted">by {part.delivery_date}</span> : null}
        </>
      )}
    </form>
  );
}
