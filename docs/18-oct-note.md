# 18 October 2026 — delivery note

What was asked for on 18 October, section by section, in the order it was built.

## 3. The target box in plain words (owner only) — DONE

The owner's dashboard box now reads like a sentence, not a report:

- **"October so far: AED X profit"** with a progress bar and "Z% of target (AED Y by today)".
- **"To cover costs so far: AED A → short by AED B"** in red, or "AED B above" in green.
- **"Coming from cars in the workshop: AED C"** — approved work not yet invoiced.
- **"If the month continues like this: AED D"**.
- A smaller line: **"Today: AED E profit invoiced · AED F collected"**.

No jargon anywhere on the face of it: no "break-even", no "provisional" (late costs read "costs still arriving on N jobs"). A small **"How is this worked out?"** link opens a plain explanation of every line. The sums are exactly the ones already built — only the words changed.

## 4. The advisors' daily profit figure — DONE

The top of every advisor's dashboard shows **one team figure**:

- **"Today: AED X profit of AED 20,000"** with a progress bar.
- **"To hit October: AED Y profit a day from now"** — the month's remaining target spread over the working days left (Sundays never counted).

It is measured on the profit of work customers **approve** (the approved quotations, before VAT, after every job cost) — never sales value. The daily target is yours from Settings. There is no ranking and no comparison anywhere, and advisors never see fixed costs, break-even or the projection — those stay on your dashboard only.

**"My month"** folds open each advisor's own numbers: quotations sent, approved (with the percentage), profit approved, average margin, and cars delivered on time.

## 5. Low-profit colours and the warning — DONE

- The quotation's profit shows **green, yellow or red** in the editor's bottom bar ("Profit n%") and on the Profit figure in the internal summary.
- Yellow below **30%** margin, red below **20%** — both editable in **Settings → Quote profit: yellow below (%) / red below (%)**.
- Pressing **"Quotation complete"** on a red quote asks once: *"This is too low of a profit (AED x on AED y, z%). Are you sure you want to send?"* with **"Go back and fix"** and **"Send anyway"**.
- "Send anyway" is allowed: it is written on the quotation's history, and you are told once — **"Low-profit quote sent by [advisor]: [car], [margin]%"** — at the moment the quotation actually completes, never twice.
- Yellow is a colour only; it never asks.

## 2. Tidy WhatsApp messages — DONE

- **Every template rewritten** in the tidy style: short sections with line breaks, WhatsApp bold (`*text*`), signed "OFJ Automotive", no staff names. All 18 templates (quotation, revised quotation, estimate, inspection report, check-in approval, car ready/proforma, tax invoice, deposit receipt, follow-up, the four appointment reminders, final check, the three bodyshop updates, and "on its way") were rewritten both as the defaults and in the database — you can still edit each one in Settings.
- **Short links**: every link we send is now our own short link, e.g. `erp.ofjauto.com/m/k3X9`, which redirects to the full page. This covers the quotation, estimate, report, approval, proforma, tax invoice, deposit receipt, bodyshop progress and handover links, the customer's Google Maps pin and the driver's one-button page (`erp.ofjauto.com/d/xxxx`). A link is made once and reused.
- **Phones formatted**: numbers in messages read "+971 52 956 2232", never "+971529562232".
- **Names cleaned**: "L.l.c" becomes "LLC" (also FZE, FZCO, FZ-LLC, DMCC); greetings drop the legal ending; and when a company customer has a contact person saved, the greeting goes to the person ("Dear Ahmed,") rather than the company.
- **The driver's message** follows the agreed format:

  ```
  *DELIVERY · SUN 18 OCT · MORNING*
  Dubai A 12345
  Mercedes G63 2022

  *Customer:* Ahmed Al Maktoum
  *Mobile:* +971 52 956 2232
  *Location:* Dubai Hills erp.ofjauto.com/m/k3X9
  *When delivered, tap:* erp.ofjauto.com/d/xxxx
  ```

- **The "on its way" message** is now a proper template you can edit in **Settings → QC, car ready and follow-up → WhatsApp "on its way"**: Dear [name] / Your *[car]* is on its way / *Recovery truck:* / *Driver:* / the call line. (It existed before but was not editable — that gap is closed.)
- The quotation send window was checked on a phone-width screen.

## 1. Copy next to every message button — DONE

A **Copy** button (says "Copied" for a moment) now sits next to every button that opens WhatsApp with a written message:

- Gate-out: **"Send to driver"** and inside the **"Car loaded: send 'on its way'"** window.
- Parts arrivals: **"Chase supplier"**.
- Calendar: the reminder's WhatsApp button, on the day list and on the appointment page.
- The job card's planning card: **"Tell the customer on WhatsApp"**.

The centre send windows (quotation, report, proforma, invoice, receipt) already had "Copy message and link"; the Parts supplier list and the team setup link already had Copy.

## Proof

- `tests/browser/test-y.mjs` section **H** (advisors' figure, 6 checks), section **I** (low-profit warning, 8 checks), section **J** (messages, short links and copy buttons, 15 checks); section **F** follows the plain-words target box.
- The deposit (test-t), 15 October (test-k), evening (test-l), lock (test-x), notification (test-notify) and money (test-m) suites re-run green after the new low-profit question and the short links.
- Migrations: `20261105090000_quote_margin_limits.sql`, `20261106090000_short_links_tidy_messages.sql` (backed up first: `backups/2026-10-18T06-45-46`).

## Assumptions

1. **Greeting a company's contact person**: we store one name per customer (`full_name`) plus the company name. When both are set and differ, the greeting uses the person's name — "Dear Ahmed Al Maktoum,". We do not store titles (Mr/Mrs), so the greeting is the name without "Mr" rather than guessing a title.
2. **Short links always show the live address** (`erp.ofjauto.com/…`) even when testing locally, like every other generated link in the system.
3. **Overwriting the stored templates**: the migration rewrote all 18 stored templates to the tidy wording, replacing any earlier edits, since the batch asked for the new style everywhere. Each is still editable in Settings.
4. **[advisor] dropped from reminders**: staff names never go to customers (the standing rule), so the reminder templates now sign "OFJ Automotive".
5. **Pay-now links** (the card payment links from the gateway) are not shortened: they are the gateway's own addresses and the system only ever shows them as "Pay now" on the proforma page, not as raw links in messages.
6. **The low-profit owner message** is skipped when the owner himself sends a red quote (he would only be telling himself).
7. **Yellow never asks** — it is a colour only; only red asks "Are you sure?".
