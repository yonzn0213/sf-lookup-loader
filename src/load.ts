import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type { Connection } from "jsforce";
import type { Job } from "./types.js";
import { writeRows, summarize } from "./report.js";

export function buildBulkOptions(job: Job): Record<string, string> {
  const opts: Record<string, string> = { object: job.object, operation: job.operation };
  if (job.operation === "upsert") opts.externalIdFieldName = job.externalIdField!;
  return opts;
}

export function summarizeResults(
  successful: Array<Record<string, any>>,
  failed: Array<Record<string, any>>,
): { success: number; fail: number; rows: Array<Record<string, string>> } {
  const rows: Array<Record<string, string>> = [];
  for (const s of successful) rows.push({ status: "success", id: String(s.sf__Id ?? ""), error: "" });
  for (const f of failed) rows.push({ status: "fail", id: "", error: String(f.sf__Error ?? "") });
  return { success: successful.length, fail: failed.length, rows };
}

async function readRows(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, trim: true }));
  for await (const rec of parser) rows.push(rec as Record<string, string>);
  return rows;
}

export async function load(conn: Connection, job: Job, inputPath: string): Promise<{
  success: number; fail: number; resultsPath: string;
}> {
  const records = await readRows(inputPath);
  const res: any = await (conn as any).bulk2.loadAndWaitForResults({ ...buildBulkOptions(job), input: records });
  const summary = summarizeResults(res.successfulResults ?? [], res.failedResults ?? []);
  const resultsPath = inputPath.replace(/\.csv$/i, "") + ".results.csv";
  writeRows(resultsPath, summary.rows, ["status", "id", "error"]);
  summarize("load", { 입력: records.length, 성공: summary.success, 실패: summary.fail });
  return { success: summary.success, fail: summary.fail, resultsPath };
}
