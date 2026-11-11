"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="min-h-11 rounded-control bg-ink px-5 font-bold text-on-dark">Print</button>;
}
