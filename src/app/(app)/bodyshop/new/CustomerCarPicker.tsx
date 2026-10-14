"use client";

import { useState } from "react";
import { Select } from "@/components/ui";

/** Customer first, then that customer's cars. Two drop-downs; the lists are long, so a search box narrows the customers. */
export function CustomerCarPicker({ customers, cars, initialCustomer }: { customers: { id: string; label: string }[]; cars: { id: string; customerId: string; label: string }[]; initialCustomer: string }) {
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [q, setQ] = useState("");
  const shown = q.trim() ? customers.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200) : customers.slice(0, 200);
  const theirs = cars.filter((c) => c.customerId === customerId);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Find the customer</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, company or phone" className="min-h-11 rounded-control border border-line-strong px-3 text-sm" spellCheck={false} aria-label="Find the customer" data-customer-search />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Customer</span>
        <Select name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required data-customer-select>
          <option value="">Choose…</option>
          {shown.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          {customerId && !shown.some((c) => c.id === customerId) ? <option value={customerId}>{customers.find((c) => c.id === customerId)?.label ?? "Chosen customer"}</option> : null}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Car</span>
        <Select name="vehicle_id" required disabled={!customerId} defaultValue="" data-vehicle-select>
          <option value="">{customerId ? (theirs.length ? "Choose…" : "No cars for this customer yet") : "Choose the customer first"}</option>
          {theirs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </label>
    </div>
  );
}
