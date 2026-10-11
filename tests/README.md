# Tests

Browser tests that drive the real screens in a headless Microsoft Edge against a local copy of the site. They use the test-only routes under `/api/e2e/*` (refused in production) and remove every row they create.

## Before running

1. `E2E_SECRET=<any long random text>` in `.env.local` (already there on the owner's PC).
2. Start the local server in one terminal: `npx next dev -p 3100`.
3. Edge must be installed at its usual place (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`), or set `E2E_BROWSER` to another Chromium browser.

## Running

```bash
npm run test:notify     # one car through the whole path; checks who is told at every hand-over
npm run test:day1       # the fixes from the first day of staff testing (71 checks)
npm run test:overnight  # loose items, stickers, handover with PIN, breaks, reports (66 checks)
npm run test:cleanup    # removes every test row by hand, if a run was stopped halfway
```

Each run prints one line per check (`OK` or `FAIL`) and a total, cleans up at the start and at the end, and exits with 1 when anything failed.

## Rules the tests follow

- Wait for a form's redirect by the URL changing, never for "networkidle" (the notification poll never stops).
- Never edit source files while a run is going: every save reloads the pages mid-test.
- Test customers have a phone starting `+9715000000`, seeded rows have ids `22222222-0000-4000-8000-00000000e…`, test services and emails start with `e2e `; `tests/e2e-cleanup.sql` removes all of them.
