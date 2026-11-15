import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuditLog,
  CsvConnector,
  HttpConnector,
  SpecValidationError,
  applyTransforms,
  classify,
  collect,
  contactTarget,
  createSpec,
  maskValue,
  normalizePhone,
  parseDate,
  profileRecords,
  runPipeline,
  splitName,
  suggestHeuristic,
  suggestMappings,
  verifyChain,
} from "../src";

const csv = readFileSync(join(__dirname, "../../../examples/acme_legacy_contacts.csv"), "utf8");
const load = () => collect(new CsvConnector(csv));

describe("transforms", () => {
  it("parses the date formats customers actually send", () => {
    expect(parseDate("03/14/2021")).toBe("2021-03-14T00:00:00.000Z");
    expect(parseDate("2022-01-09")).toBe("2022-01-09T00:00:00.000Z");
    expect(parseDate("Mar 3 2023")).toBe("2023-03-03T00:00:00.000Z");
    expect(parseDate("Apr 22, 2024")).toBe("2024-04-22T00:00:00.000Z");
    expect(parseDate("02/30/2024")).toBe("02/30/2024"); // invalid → untouched, validator reports it
  });

  it("normalizes phones to E.164", () => {
    expect(normalizePhone("(415) 555-0101")).toBe("+14155550101");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("(650) 555-0177 x204")).toBe("+16505550177");
  });

  it("splits names including 'Last, First'", () => {
    expect(splitName("Patel, Arjun", "first")).toBe("Arjun");
    expect(splitName("Liam O'Brien", "last")).toBe("O'Brien");
  });

  it("parses currency-ish numbers", () => {
    expect(applyTransforms("$12,500", [{ op: "toNumber" }])).toBe(12500);
    expect(applyTransforms("8.5k", [{ op: "toNumber" }])).toBe(8500);
  });
});

describe("inference", () => {
  it("classifies values", () => {
    expect(classify("jane@x.com")).toBe("email");
    expect(classify("(415) 555-0101")).toBe("phone");
    expect(classify("03/14/2021")).toBe("date");
  });

  it("profiles the messy export", async () => {
    const p = profileRecords(await load());
    const byName = Object.fromEntries(p.fields.map((f) => [f.name, f]));
    expect(byName["E-mail Address"]?.inferredType).toBe("email"); // 95% valid → still email; validator catches the bad one
    expect(byName["ACV ($)"]?.inferredType).toBe("string"); // "15k" mixed in → degrades safely to string
    expect(byName["Tel"]?.inferredType).toBe("phone");
    expect(byName["Status"]?.distinctValues).toContain("Active Customer");
  });
});

describe("heuristic mapper", () => {
  it("maps the messy export to the target with no LLM", async () => {
    const fields = suggestHeuristic(profileRecords(await load()), contactTarget);
    const m = Object.fromEntries(fields.map((f) => [f.target, f]));
    expect(m.external_id?.source).toBe("Cust ID");
    expect(m.email?.source).toBe("E-mail Address");
    expect(m.phone?.source).toBe("Tel");
    expect(m.company?.source).toBe("Organisation");
    expect(m.first_name?.source).toBe("Full Name");
    expect(m.first_name?.transforms).toContainEqual({ op: "splitName", part: "first" });
    expect(m.lifecycle_stage?.source).toBe("Status");
    expect(m.annual_revenue?.source).toBe("ACV ($)");
    expect(m.created_at?.source).toBe("Date Added");
  });

  it("infers an enum map for lifecycle stage", async () => {
    const fields = suggestHeuristic(profileRecords(await load()), contactTarget);
    const t = fields.find((f) => f.target === "lifecycle_stage")!.transforms.find((t) => t.op === "enumMap");
    expect(t).toMatchObject({ op: "enumMap", map: { "Active Customer": "customer", Cancelled: "churned", Trial: "prospect", Inactive: "churned" } });
  });
});

describe("pipeline", () => {
  it("dry-runs and reports row-level errors the customer can act on", async () => {
    const records = await load();
    const fields = suggestHeuristic(profileRecords(records), contactTarget);
    const report = runPipeline(records, createSpec(contactTarget, records, fields), contactTarget, { dryRun: true });
    expect(report.total).toBe(21);
    expect(report.valid).toBeGreaterThan(14);
    expect(report.errorsByField.external_id).toBe(1); // AC-1001 exported twice
    expect(report.errors.some((e) => e.field === "email" && e.row === 8)).toBe(true); // kenji@soylent
    expect(report.preview[0]).toMatchObject({ email: "jane.doe@initech.com", phone: "+14155550101", annual_revenue: 12500 });
  });

  it("refuses a real run until required fields are human-approved", async () => {
    const records = await load();
    const spec = createSpec(contactTarget, records, suggestHeuristic(profileRecords(records), contactTarget));
    expect(() => runPipeline(records, spec, contactTarget, { dryRun: false })).toThrow(SpecValidationError);
    spec.fields.forEach((f) => (f.approved = true));
    expect(runPipeline(records, spec, contactTarget, { dryRun: false }).valid).toBeGreaterThan(0);
  });

  it("detects source schema drift", async () => {
    const records = await load();
    const spec = createSpec(contactTarget, records, suggestHeuristic(profileRecords(records), contactTarget).map((f) => ({ ...f, approved: true })));
    const drifted = records.map(({ Tel, ...r }) => ({ ...r, Mobile: Tel }));
    expect(() => runPipeline(drifted, spec, contactTarget, { dryRun: false })).toThrow(/source shape changed/);
  });
});

describe("LLM mapper guardrails", () => {
  const fakeFetch = (payload: unknown, status = 200) =>
    (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;

  it("falls back to heuristic without an API key", async () => {
    const r = await suggestMappings(profileRecords(await load()), contactTarget, { apiKey: "" });
    expect(r.engine).toBe("heuristic");
    expect(r.fallbackReason).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("rejects hallucinated columns", async () => {
    const text = JSON.stringify({ mappings: [{ target: "email", source: "EmailAddr", transforms: [], confidence: 0.99, rationale: "x" }] });
    const r = await suggestMappings(profileRecords(await load()), contactTarget, {
      apiKey: "k",
      fetchImpl: fakeFetch({ content: [{ type: "text", text }] }),
    });
    expect(r.fields.find((f) => f.target === "email")?.source).toBe("E-mail Address");
    expect(r.fallbackReason).toMatch(/hallucinated/);
  });

  it("falls back on API errors", async () => {
    const r = await suggestMappings(profileRecords(await load()), contactTarget, { apiKey: "k", fetchImpl: fakeFetch({}, 529) });
    expect(r.engine).toBe("heuristic");
  });

  it("masks PII by default", () => {
    expect(maskValue("jane@acme.com")).toBe("a***@a***.a***");
    expect(maskValue("415-555-0101")).toBe("999-999-9999");
  });
});

describe("HttpConnector", () => {
  it("paginates and retries on 429", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (calls === 1) return new Response("", { status: 429, headers: { "retry-after": "0" } });
      const page = new URL(url).searchParams.get("page") ?? "1";
      return new Response(JSON.stringify({ data: [{ id: page }], next: page === "1" ? "?page=2" : null }));
    }) as unknown as typeof fetch;
    const rows = await collect(new HttpConnector({ url: "https://api.example.com/contacts", recordsPath: "data", nextPath: "next", fetchImpl }));
    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
  });
});

describe("audit log", () => {
  it("hash-chains events and detects tampering", async () => {
    const log = new AuditLog(join(mkdtempSync(join(tmpdir(), "fk-")), "audit.jsonl"));
    await log.append("alice", "suggest", { engine: "heuristic" });
    await log.append("alice", "approve", { field: "email" });
    expect(await log.verify()).toEqual({ ok: true });
    const events = await log.read();
    events[0]!.actor = "mallory";
    expect(verifyChain(events)).toEqual({ ok: false, brokenAt: 1 });
  });
});
