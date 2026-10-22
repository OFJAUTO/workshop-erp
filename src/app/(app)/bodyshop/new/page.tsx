import { redirect } from "next/navigation";

/**
 * Section 6 (21 October): ONE way to quote. The old "New bodyshop quotation" (a booked job before the
 * car arrived) is retired: a car quoted before arrival is an ESTIMATE, started here with Bodyshop and
 * the package picker pre-selected. At gate-in the accepted estimate becomes the job's quotation with
 * nothing retyped. Old links land on the same path.
 */
export default function NewBodyshopPage() {
  redirect("/estimates/new?bodyshop=1");
}
