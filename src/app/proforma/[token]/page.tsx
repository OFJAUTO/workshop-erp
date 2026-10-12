import type { Metadata } from "next";
import { customerPageMetadata } from "@/lib/customer-pages";
import CustomerInvoicePage from "../../invoice/[token]/page";

export const dynamic = "force-dynamic";

/** The proforma's own address: before payment the link, its preview and the page all say proforma, never invoice. Once paid, the same page shows the tax invoice. */
export async function generateMetadata(): Promise<Metadata> {
  return customerPageMetadata("OFJ Automotive, Your Proforma", "Your proforma and the amount due, with the PDF to view");
}

export default CustomerInvoicePage;
