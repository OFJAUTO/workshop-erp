# Stock: reverse a mistaken entry (10 November 2026, Section 8)

- On Parts > Stock, every entry that brought stock in has **Reverse this entry**: a compulsory reason, then either "Reverse it (entered by mistake)" or "Move to a job instead (it was bought for a car)" with the job.
- The owner gets a bell and decides on the **Reversed entries** card of the stock page (Approve / Refuse, optional note).
- Approved reverse: the opposite movement "−5 → 0 · reversed: entered by mistake · approved by Omar"; quantity and average value corrected; the original entry stays in the history; nothing is deleted.
- Approved move: the stock is issued to that job, so its cost lands on the car (logged on the job).
- Blocked when some of it was already issued since: the message names the jobs ("only 2 left on the shelf of the 5 entered").
- An item with no stock left has **Archive**: hidden from the lists, never deleted.

Switches on once `20261212110000_stock_reversals.sql` is applied (Archive works now). Test: `test:sim` path d8 (8 checks). Proof: `docs/proof/2026-11-10-stock-reverse/`.
