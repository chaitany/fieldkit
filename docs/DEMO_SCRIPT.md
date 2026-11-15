# 4-minute demo script (Loom or a live interview)

Record this and put the link at the top of the README and on your resume. A hiring manager
will watch 4 minutes. They won't clone a repo.

**0:00 – The hook (20s)**
"Every B2B product loses weeks between contract signed and customer live, mostly to data onboarding.
This is the export a real customer sends." *Open the CSV and point at the mess: `Full Name`,
`$12,500` next to `15k`, four date formats, a duplicate row, `Tel` with an extension.*

**0:20 – Profile + suggest (60s)**
Click *Load sample*. "It profiles the columns. Here's the inferred type, here's an enum-like status
column with 12 values. It then proposes a mapping. Note the full-name split into first and last, and
the enum map: `Cancelled → churned`, `Trial → prospect`, `Inactive → churned`."
Point at the ⚠ banner: "No API key here, so it's on the offline heuristic engine, and it says so.
Silent fallbacks destroy trust."

**1:20 – Human in the loop (45s)**
Try *Run import*: it's disabled. "Nothing ships until a human approves the required fields." Click
*Approve all ≥ 0.80*, then manually tick first and last name. "The 0.70 ones need a deliberate decision."

**2:05 – Dry run (60s)**
Click *Dry run*. "17 of 21 clean. The other 4 are reported by **spreadsheet row number**: row 8 is an
invalid email, row 14 is the same customer exported twice, row 19 has no status. I send that list to the
customer's admin. That's the FDE workflow: you turn a data problem into a short to-do list."

**3:05 – Trust story (40s)**
Point at the audit trail. "Every suggest, approve and run is hash-chained, so I can answer
'who approved this mapping?' in a security review." Switch to the terminal and run `fieldkit run`
with a renamed column: "If the customer renames a column next month, the run refuses to start
instead of silently dropping data."

**3:45 – Close (15s)**
"The same engine runs as a CLI inside the customer's VPC. The LLM proposes, the human approves, the
schema enforces. The ADRs explain each tradeoff."
