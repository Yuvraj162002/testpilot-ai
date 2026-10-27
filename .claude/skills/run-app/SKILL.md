---
name: run-app
description: Start TestPilot AI locally and smoke-test it end to end on the AcmeCart demo shop. Use when the user asks to run, start or check the app, says the links don't open, or after a backend/AI change.
---

# Run and smoke-test

## Start

Check first — "site can't be reached" almost always means the servers are not running:

```bash
ss -ltn | grep -E ':(5173|8000)\b'
```

Not running → start `./dev.sh` in the background (it runs both servers and stops both on exit), then
wait until `curl -s localhost:8000/api/health` returns `{"ok":true,...}` and `curl -s -o /dev/null -w
'%{http_code}' localhost:5173` returns 200. If `uvicorn`/`vite` is missing, do the setup in `README.md`.

Links for the user: http://localhost:5173 · http://localhost:8000/docs · http://localhost:8000/demo/

## Smoke test against the demo shop (needs a working AI provider)

1. Plan:
   ```bash
   curl -s localhost:8000/api/plans -H 'content-type: application/json' -d '{
     "url": "http://localhost:8000/demo/",
     "requirements": "A shopper can add a product to the cart and check out with discount code SAVE10. Signing in with a wrong password shows an error."
   }'
   ```
   Expect 4–10 cases, each with steps and an observable expected result.
2. Run: POST `/api/runs` with the same `url` and the returned `cases`; poll `GET /api/runs/{id}` until
   `status` is not `Running`.
3. Expected outcome — the agent is right only if it finds the planted bugs:
   - SAVE10 checkout case → **Failed** (500 in `network_errors`).
   - Wrong-password case → **Failed** (no error message).
   - Plain add-to-cart → **Passed** with evidence that is really on the page.
4. Report pass/fail per case to the user. A `Passed` on a SAVE10 or wrong-password case is an AI error:
   look at the case `log` and `reason` and say so — don't hide it.

Never point a run at a customer's site or APK.
