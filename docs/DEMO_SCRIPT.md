# 4-minute demo script (Loom or a live interview)

Record this and put the link at the top of the README and on your resume. A hiring manager
will watch 4 minutes. They won't clone a repo.

**0:00 – The hook (20s)**
"Every B2B product loses weeks between contract signed and customer live, mostly to data onboarding.
This is the export a real customer sends." *Open the CSV and point at the mess: `Full Name`,
`$12,500` next to `15k`, four date formats, a duplicate row, `Tel` with an extension.*

**0:20 – Profile + suggest (60s)**
Click *Load the sample export*. The connection lines draw in one by one. "It profiles the columns. Here's the inferred type, here's an enum-like status
column with 12 values. It then proposes a mapping. Note the full-name split into first and last, and
the enum map: `Cancelled → churned`, `Trial → prospect`, `Inactive → churned`."
Point at the ⚠ banner: "No API key here, so it's on the offline heuristic engine, and it says so.
Silent fallbacks destroy trust."

**1:20 – Human in the loop (45s)**
Try *Import and download*: it's disabled. "Nothing ships until a human approves the required fields." Click
*Approve all likely matches*, then click `first_name` to open its details and approve it, and tick `last_name`. Approved lines turn solid. "The 0.70 ones need a deliberate decision."

**2:05 – Dry run (60s)**
Click *Dry run*. "17 of 21 clean. The other 4 are reported by **spreadsheet row number**: row 8 is an
invalid email, row 14 is the same customer exported twice, row 19 has no status. *Copy fix list* puts that list on the clipboard, ready for the
customer's admin. That's the FDE workflow: you turn a data problem into a short to-do list."

**3:05 – Trust story (40s)**
Point at the audit trail. "Every suggest, approve and run is hash-chained, so I can answer
'who approved this mapping?' in a security review." Switch to the terminal and run `fieldkit run`
with a renamed column: "If the customer renames a column next month, the run refuses to start
instead of silently dropping data."

**Bonus, if they ask "how do you stop someone burning your API key?" (30s)**
Point at the engine picker: "The public demo never uses my key. It's ignored even if someone sets it by mistake.
Visitors either use the free offline engine or bring their own key, which stays in tab memory and is never stored or logged.
If I ever do host a key, there's an opt-in mode with a sample-only restriction, a cache, quotas and a workspace spend cap." (ADR-0005)

**3:45 – Close (15s)**
"The same engine runs as a CLI inside the customer's VPC. The LLM proposes, the human approves, the
schema enforces. The ADRs explain each tradeoff."
