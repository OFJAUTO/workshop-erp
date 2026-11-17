# Section 5 (17 November 2026): share a draft LPO with the supplier before approval

## What changed

- **Before approval, the parts desk can share a DRAFT.** On a waiting LPO, the card "Share a draft with the supplier" has one button per supplier: **"Share draft with <supplier>"**.
  - The draft is the same supplier copy, with **DRAFT** across every page and, in the header and the footer: **"DRAFT - FOR PRICE AND AVAILABILITY ONLY. NOT AN ORDER UNTIL APPROVED."**
  - It has no "Approved electronically" block and no QR code.
  - A waiting main LPO holds several suppliers, so each supplier's draft shows only that supplier's lines.
- **After approval, the clean LPO is shared the same way:** the **"Share"** button on the supplier's LPO.
- **One Share window: WhatsApp or email.**
  - **WhatsApp:**
    1. Share the PDF. On a phone this opens the share list; on a computer it downloads, then attach it in the chat.
    2. Open WhatsApp to the supplier with the message written for you.
  - **Email:** the PDF is sent from the parts mailbox to the supplier's saved email. Supplier email stays send-only.
  - When the supplier has no phone or email saved, the window says so with a link to Suppliers.
- **The LPO page shows every share:**
  - "Draft shared with <supplier> · <date, time> · <who> (WhatsApp/email)";
  - "LPO sent to <supplier> · <date, time> · <who> (…)".
- **The real LPO is never shared before approval.** Its PDF and its email refuse a waiting LPO, and the draft is refused once the LPO is approved.
- **Nudge:** an approved LPO not sent after **2 working hours** tells the parts desk once ("Approved, not sent yet · LPO-…"). This is checked by the hourly clean-up.

## Read-only check on live: approved LPOs not sent for more than 4 working hours

Nothing is waiting now. In the last 30 days these took more than 4 working hours from approval to being sent (Mon–Sat, 08:00–17:00):

| LPO | Supplier | Approved | Sent after |
|---|---|---|---|
| LPO-00037-1 | OFJ Additional | 31 Oct 12:55 | 5.8 working h |
| LPO-00039-1 | AL TAYER MOTORS LLC | 3 Nov 14:34 | 11.2 working h |
| LPO-00058-2 | TRADING ENTERPRISES COMPANY LLC | 7 Nov 09:28 | 9.4 working h |
| LPO-00076-3 | DUBLIN AUTO SPARE PARTS LLC BR | 12 Nov 12:32 | 5.3 working h |
| LPO-00089 | VEGA AUTO SPARE PARTS TRADING LLC. | 13 Nov 14:46 | 8.0 working h |
| LPO-00085-1 | AL TAYER MOTORS LLC | 16 Nov 13:27 | 5.6 working h (sent today 10:05) |

## Proof (TEST)

- `npm run test:s17-5` passes 11 of 11, signed in as the parts desk. It covers:
  - the draft button and window;
  - the draft PDF read back with its words and the DRAFT mark;
  - the WhatsApp share recorded and shown;
  - the real LPO refused before approval, and the draft refused after it;
  - Share on the approved LPO recorded as sent;
  - the not-sent nudge (once).
- Screenshots and the draft PDF are in `docs/proof/2026-11-17-draft-lpo/` (1440 and 800 wide, `draft-lpo.pdf`, `draft-lpo-page1.png`).

No database change (the shares are kept in the change log).
