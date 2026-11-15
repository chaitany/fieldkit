import Papa from "papaparse";
import type { RawRecord } from "../types";

/**
 * A Connector is the seam between Fieldkit and a customer system.
 * Every new customer usually means a new connector, so the contract is deliberately tiny.
 */
export interface Connector {
  readonly kind: string;
  extract(): AsyncIterable<RawRecord[]>;
}

export async function collect(connector: Connector, limit = Infinity): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  for await (const batch of connector.extract()) {
    for (const r of batch) {
      if (out.length >= limit) return out;
      out.push(r);
    }
  }
  return out;
}

export class CsvConnector implements Connector {
  readonly kind = "csv";
  constructor(private readonly text: string, private readonly batchSize = 1000) {}

  async *extract(): AsyncIterable<RawRecord[]> {
    // Strip BOM — Excel exports from customer finance teams almost always have one.
    const clean = this.text.replace(/^﻿/, "");
    const parsed = Papa.parse<RawRecord>(clean, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    });
    const rows = parsed.data;
    for (let i = 0; i < rows.length; i += this.batchSize) {
      yield rows.slice(i, i + this.batchSize);
    }
  }
}

export interface HttpConnectorOptions {
  url: string;
  headers?: Record<string, string>;
  /** Dot-path to the records array in the response body, e.g. "data.items". */
  recordsPath?: string;
  /** Dot-path to the next-page cursor/URL. Pagination stops when it is empty. */
  nextPath?: string;
  maxPages?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

function getPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>(
    (acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined),
    obj,
  );
}

/** Generic paginated REST connector with retry + backoff on 429/5xx. */
export class HttpConnector implements Connector {
  readonly kind = "http";
  constructor(private readonly opts: HttpConnectorOptions) {}

  private async fetchWithRetry(url: string): Promise<unknown> {
    const f = this.opts.fetchImpl ?? fetch;
    const max = this.opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await f(url, { headers: this.opts.headers });
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max) {
        throw new Error(`HTTP ${res.status} from ${new URL(url).host} after ${attempt + 1} attempt(s)`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  async *extract(): AsyncIterable<RawRecord[]> {
    let next: string | undefined = this.opts.url;
    let pages = 0;
    while (next && pages < (this.opts.maxPages ?? 100)) {
      const body = await this.fetchWithRetry(next);
      const records = getPath(body, this.opts.recordsPath);
      if (!Array.isArray(records)) throw new Error(`Expected array at "${this.opts.recordsPath ?? "<root>"}"`);
      yield records as RawRecord[];
      const cursor = getPath(body, this.opts.nextPath);
      next = typeof cursor === "string" && cursor ? new URL(cursor, this.opts.url).toString() : undefined;
      pages++;
    }
  }
}
