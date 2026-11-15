#!/usr/bin/env -S npx tsx
/**
 * Fieldkit CLI — the headless path for running inside a customer's network
 * (VPC, on-prem, air-gapped). Same core engine as the web UI; no server required.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  AuditLog,
  CsvConnector,
  HttpConnector,
  MappingSpecSchema,
  SpecValidationError,
  collect,
  createSpec,
  getTarget,
  profileRecords,
  runPipeline,
  suggestMappings,
  type Connector,
  type MappingSpec,
} from "@fieldkit/core";

const HELP = `fieldkit — AI-assisted, human-approved customer data onboarding

Usage:
  fieldkit profile  --source <file.csv|url>
  fieldkit suggest  --source <src> --target contact [--out mapping.json] [--share-samples]
  fieldkit approve  --mapping mapping.json [--fields a,b,c | --all]
  fieldkit run      --source <src> --target contact [--mapping mapping.json] [--dry-run] [--out out.jsonl]
  fieldkit audit    verify

Options:
  --records-path  Dot-path to records in an HTTP JSON response (e.g. data.items)
  --next-path     Dot-path to the next-page URL/cursor
  --actor         Name recorded in the audit log (default: $USER)

Environment:
  ANTHROPIC_API_KEY  Enables LLM-assisted mapping. Without it, the offline heuristic mapper is used.
  FIELDKIT_AUDIT     Audit log path (default: .fieldkit/audit.jsonl)
`;

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    target: { type: "string", default: "contact" },
    mapping: { type: "string" },
    out: { type: "string" },
    fields: { type: "string" },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "share-samples": { type: "boolean", default: false },
    "records-path": { type: "string" },
    "next-path": { type: "string" },
    actor: { type: "string", default: process.env.USER ?? "cli" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const audit = new AuditLog(process.env.FIELDKIT_AUDIT ?? ".fieldkit/audit.jsonl");
const c = { dim: (s: string) => `\x1b[2m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, red: (s: string) => `\x1b[31m${s}\x1b[0m`, yellow: (s: string) => `\x1b[33m${s}\x1b[0m`, bold: (s: string) => `\x1b[1m${s}\x1b[0m` };

async function connectorFor(source: string): Promise<Connector> {
  if (/^https?:\/\//.test(source)) {
    return new HttpConnector({
      url: source,
      recordsPath: args["records-path"],
      nextPath: args["next-path"],
      headers: process.env.SOURCE_AUTH ? { authorization: process.env.SOURCE_AUTH } : undefined,
    });
  }
  return new CsvConnector(await readFile(resolve(source), "utf8"));
}

function need(name: keyof typeof args): string {
  const v = args[name];
  if (typeof v !== "string" || !v) throw new Error(`--${name} is required`);
  return v;
}

function printMapping(spec: Pick<MappingSpec, "fields">) {
  const rows = spec.fields.map((f) => {
    const conf = f.confidence >= 0.8 ? c.green : f.confidence >= 0.5 ? c.yellow : c.red;
    const ops = f.transforms.map((t) => t.op).join("→") || "—";
    return `  ${f.approved ? c.green("✔") : c.dim("·")} ${f.target.padEnd(16)} ← ${(f.source ?? c.red("(unmapped)")).padEnd(18)} ${conf(f.confidence.toFixed(2))}  ${c.dim(ops)}`;
  });
  console.log(rows.join("\n"));
}

async function main() {
  const [cmd, sub] = positionals;
  if (args.help || !cmd) return console.log(HELP);

  if (cmd === "profile") {
    const records = await collect(await connectorFor(need("source")));
    const p = profileRecords(records);
    console.log(c.bold(`${p.recordCount} records, ${p.fields.length} columns\n`));
    for (const f of p.fields) {
      console.log(`  ${f.name.padEnd(20)} ${f.inferredType.padEnd(8)} fill ${(f.fillRate * 100).toFixed(0).padStart(3)}%  distinct ${String(f.distinctCount).padStart(4)}  ${c.dim(f.samples.slice(0, 3).join(" | "))}`);
    }
    await audit.append(args.actor!, "profile", { source: args.source, records: p.recordCount });
    return;
  }

  if (cmd === "suggest") {
    const target = getTarget(args.target!);
    const records = await collect(await connectorFor(need("source")));
    const result = await suggestMappings(profileRecords(records), target, { shareSamples: args["share-samples"] });
    const spec = createSpec(target, records, result.fields);
    console.log(c.bold(`Suggested mapping (${result.engine})`) + (result.fallbackReason ? c.yellow(`  ⚠ ${result.fallbackReason}`) : ""));
    printMapping(spec);
    const out = args.out ?? "mapping.json";
    await writeFile(out, JSON.stringify(spec, null, 2));
    await audit.append(args.actor!, "suggest", { engine: result.engine, fallbackReason: result.fallbackReason, out, usage: result.usage });
    console.log(c.dim(`\nWrote ${out}. Review it, then: fieldkit approve --mapping ${out} --all`));
    return;
  }

  if (cmd === "approve") {
    const path = need("mapping");
    const spec = MappingSpecSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const wanted = args.all ? spec.fields.map((f) => f.target) : need("fields").split(",").map((s) => s.trim());
    for (const f of spec.fields) if (wanted.includes(f.target) && f.source !== null) f.approved = true;
    await writeFile(path, JSON.stringify(spec, null, 2));
    await audit.append(args.actor!, "approve", { mapping: path, fields: wanted });
    printMapping(spec);
    return;
  }

  if (cmd === "run") {
    const target = getTarget(args.target!);
    const records = await collect(await connectorFor(need("source")));
    let spec: MappingSpec;
    if (args.mapping) {
      spec = MappingSpecSchema.parse(JSON.parse(await readFile(args.mapping, "utf8")));
    } else {
      if (!args["dry-run"]) throw new Error("A real run requires an approved --mapping file. Use --dry-run to preview.");
      const result = await suggestMappings(profileRecords(records), target);
      spec = createSpec(target, records, result.fields);
      console.log(c.bold(`Mapping (${result.engine}, unapproved — dry run only)`));
      printMapping(spec);
      console.log();
    }
    const report = runPipeline(records, spec, target, { dryRun: args["dry-run"] });
    const pct = ((report.valid / Math.max(report.total, 1)) * 100).toFixed(1);
    console.log(c.bold(`${report.dryRun ? "DRY RUN" : "RUN"} ${report.runId.slice(0, 8)}: `) + `${c.green(`${report.valid} valid`)}, ${report.invalid ? c.red(`${report.invalid} invalid`) : "0 invalid"} of ${report.total} (${pct}%) in ${report.durationMs}ms`);
    if (report.invalid) {
      console.log(c.bold("\nErrors by field:"));
      for (const [f, n] of Object.entries(report.errorsByField).sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(16)} ${n}`);
      console.log(c.bold("\nFirst errors (row numbers match the customer's spreadsheet):"));
      for (const e of report.errors.slice(0, 8)) console.log(`  row ${String(e.row).padStart(4)}  ${e.field.padEnd(16)} ${e.message} ${c.dim(JSON.stringify(e.value) ?? "")}`);
    }
    if (!report.dryRun) {
      const out = args.out ?? "output.jsonl";
      await writeFile(out, report.output.map((r) => JSON.stringify(r)).join("\n") + "\n");
      console.log(c.dim(`\nWrote ${report.valid} records to ${out}`));
    }
    await audit.append(args.actor!, report.dryRun ? "dry_run" : "run", { runId: report.runId, total: report.total, valid: report.valid, invalid: report.invalid, errorsByField: report.errorsByField });
    return;
  }

  if (cmd === "audit" && sub === "verify") {
    const events = await audit.read();
    const r = await audit.verify();
    console.log(r.ok ? c.green(`✔ audit chain intact (${events.length} events)`) : c.red(`✘ audit chain broken at event #${r.brokenAt}`));
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  console.log(HELP);
  process.exitCode = 1;
}

main().catch((err) => {
  if (err instanceof SpecValidationError) console.error(c.red(err.message));
  else console.error(c.red(`error: ${err instanceof Error ? err.message : String(err)}`));
  process.exitCode = 1;
});
