# Phase 1 decisions

Agreed with the owner (Omar Aljaf) on 6 October 2026. These add to the Decisions section of `workshop-erp-blueprint.md`.

## Technology

- Database, logins and photo storage: Supabase (hosted Postgres with row level security).
- Web app: Next.js, hosted on Vercel.
- Code: private GitHub repository owned by the company account.
- Web address: erp.ofjauto.com (the company owns ofjauto.com).
- All three accounts (GitHub, Supabase, Vercel) registered under the company email. Build starts on free plans; upgrade to Supabase Pro and Vercel Pro before go-live.

## Answers that shape Phase 1

- Existing app: a single HTML file with no database. Not reused. Start fresh from the blueprint.
- Tablets: Android, already bought.
- VIP privacy: technicians see the VIP badge and handling note only, never the customer's name or phone.
- Customer details: name, phone, email, and TRN for companies. No Emirates ID or passport stored.
- Customer contacts: extra people (drivers, assistants) per customer, each with a tick for "may approve work".
- Head count: 3 to 5 service advisors, 2 to 3 workshop managers, 2 accounts. Head accountant: Mathew Thomas.
- Car wash: done by bodyshop technicians. No separate washer role.
- Plates: emirate, code and number, plus a country field for GCC plates.
- Tablet security: PIN login works only on registered tablets. Lock after two minutes idle.
- Backup person: the owner himself (Omar Aljaf, master account). No second person named yet.

## Gate-in answers (6 October 2026, for Phase 2)

- Phones: advisors, workshop manager and owner may use a phone for the photo and video steps. The QR code opens a short-lived link (about 30 minutes) for that one job with no login on the phone; uploads are recorded under the person who showed the QR.
- Scanning: both options. VIN barcode scan, plus automatic reading of the plate (and VIN) from a camera photo using an image-recognition service, with typing as the fallback. VINs are often hard to read, so plate reading matters.
- Customer at the counter: the advisor may open the same approval page on the tablet for the customer to approve on the spot. Recorded identically to the WhatsApp route.
- Video retention: gate-in videos are deleted automatically after 6 months. Nobody can delete them by hand before that. Photos are kept.
