import "server-only";
import { Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Settings } from "@/lib/settings";
import { amountInWords } from "@/lib/money";
import { loadLogo } from "./images";
import { GREY, INK, LINE, PALE, PdfDocument, TitleRow, companyOf, px } from "./template";

/**
 * Section 2 (21 October): the COMMISSION PAYMENT VOUCHER for cash payments. Printed, signed by the
 * recipient, accounts and the owner, then the signed copy is uploaded onto the payment. Internal.
 */

export type VoucherData = {
  number: string;
  paidOn: string;
  recipient: string;
  recipientPhone: string | null;
  amount: number;
  method: "cash" | "transfer";
  reference: string | null;
  note: string | null;
  paidByName: string;
  covers: { quotation: string; job: string; plate: string; car: string; invoice: string | null; amount: number }[];
};

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SignBox({ label }: { label: string }) {
  return (
    <View style={{ flex: 1, gap: px(26) }}>
      <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
      <View style={{ borderBottomWidth: 1, borderBottomColor: INK }} />
      <Text style={{ fontSize: px(8.5), color: GREY, marginTop: px(-22) }}>Name, signature and date</Text>
    </View>
  );
}

export async function renderCommissionVoucherPdf(d: VoucherData, settings: Settings): Promise<Buffer> {
  const logo = await loadLogo();
  const company = companyOf(settings);
  const doc = (
    <PdfDocument title={`Commission payment voucher ${d.number}`} company={company} logo={logo} footerLines={["Internal document – not for the customer. The payment counts as proven only once the signed copy is uploaded."]} scanLabel={""}>
      <TitleRow title="COMMISSION PAYMENT VOUCHER" meta={[{ label: "Voucher no.", value: d.number }, { label: "Date", value: d.paidOn }, { label: "Method", value: d.method === "cash" ? "Cash" : "Bank transfer" }, d.reference ? { label: "Reference", value: d.reference } : null]} />
      <View style={{ flexDirection: "row", gap: px(12), marginTop: px(6) }}>
        <View style={{ flex: 1, backgroundColor: PALE, padding: px(12), gap: px(2) }}>
          <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4 }}>Paid to</Text>
          <Text style={{ fontSize: px(13), fontWeight: 800 }}>{d.recipient}</Text>
          {d.recipientPhone ? <Text style={{ fontSize: px(10), color: GREY }}>{d.recipientPhone}</Text> : null}
        </View>
        <View style={{ flex: 1, backgroundColor: PALE, padding: px(12), gap: px(2) }}>
          <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4 }}>Amount</Text>
          <Text style={{ fontSize: px(15), fontWeight: 800 }}>AED {money(d.amount)}</Text>
          <Text style={{ fontSize: px(9), color: GREY }}>{amountInWords(d.amount)}</Text>
        </View>
      </View>

      <View style={{ marginTop: px(14) }}>
        <Text style={{ fontSize: px(9.5), fontWeight: 700, color: GREY, textTransform: "uppercase", letterSpacing: 0.4, borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: px(3) }}>Covers</Text>
        {d.covers.map((c, i) => (
          <View key={i} style={{ flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingVertical: px(5), alignItems: "center" }}>
            <Text style={{ width: px(70), fontSize: px(10) }}>{c.quotation}</Text>
            <Text style={{ width: px(70), fontSize: px(10) }}>{c.job}</Text>
            <Text style={{ flex: 1, fontSize: px(10) }}>{[c.plate, c.car].filter(Boolean).join(" · ")}</Text>
            <Text style={{ width: px(80), fontSize: px(10), color: GREY }}>{c.invoice ?? ""}</Text>
            <Text style={{ width: px(80), fontSize: px(10.5), fontWeight: 700, textAlign: "right" }}>AED {money(c.amount)}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingVertical: px(6) }}>
          <Text style={{ fontSize: px(11), fontWeight: 800 }}>TOTAL AED {money(d.amount)}</Text>
        </View>
      </View>

      {d.note ? <Text style={{ fontSize: px(9.5), color: GREY, marginTop: px(2) }}>Note: {d.note}</Text> : null}
      <Text style={{ fontSize: px(10), marginTop: px(10) }}>Paid by (accounts): <Text style={{ fontWeight: 700 }}>{d.paidByName}</Text></Text>

      <View wrap={false} style={{ flexDirection: "row", gap: px(20), marginTop: px(34) }}>
        <SignBox label="Received by" />
        <SignBox label="Paid by (accounts)" />
        <SignBox label="Approved by (owner)" />
      </View>
    </PdfDocument>
  );
  return renderToBuffer(doc);
}
