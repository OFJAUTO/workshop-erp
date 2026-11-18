# Bank day before the receipt day (18 November 2026)

Accounts still could not date card and link settlements on the bank's posting day. On live, STL-00027 says "NETWORK COLLECTION POSTING ON 13/11/2026", but two of its receipts were recorded on 14 Nov. "Record a settlement" greyed those receipts out for any earlier day, so the settlement had to be dated 14 Nov. STL-00024, STL-00025 and STL-00029 show the same pattern.

Now:
- A receipt recorded after the chosen bank day stays in the list. It is not ticked by itself. It says "Recorded after the bank day – tick it if it is in this amount".
- When it is ticked, it says "its payment date moves to <bank day>", and the Record question names it too.
- On Record, the receipt's payment date moves to the bank day through "Correct this payment". The move keeps the closed-month rule, re-posts to Zoho, and writes the reason "Paid on or before the bank settlement of …" in the payment's history.
- The bank report upload does the same.

Supplier advance proof (17 Nov, Section 1): since that fix went live, SPAY-00043 (AED 5,030.55) and SPAY-00044 were recorded with their proofs. The last refusal was at 08:53 Dubai, before the fix. Files refused before the fix can still wait on accounts' device in the "sending" pill. They are now asked once more and say where the proof goes: "Picked before the 17 Nov fix … Add it on its payment instead … then press Remove here."

Test: `npm run test:s18-0` (9 checks, accounts, TEST). Proof: `docs/proof/2026-11-18-settle-date/`.
