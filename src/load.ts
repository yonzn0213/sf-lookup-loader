import { createReadStream } from "node:fs";
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

// Bulk 결과 행에서 sf__Id/sf__Error 등 메타 컬럼을 제거해 "재적재 가능한 원본 필드"만 남긴다.
export function stripResultMeta(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("sf__")) continue;
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

function unionHeaders(rows: Array<Record<string, string>>): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

export async function load(conn: Connection, job: Job, inputPath: string): Promise<{
  success: number; fail: number; resultsPath: string; failedPath?: string;
}> {
  // 입력을 메모리 배열로 읽지 않고 CSV 파일 스트림 그대로 Bulk2에 투입(대용량 메모리 안정).
  const res: any = await (conn as any).bulk2.loadAndWaitForResults({
    ...buildBulkOptions(job),
    input: createReadStream(inputPath),
  });
  const successful = res.successfulResults ?? [];
  const failed = res.failedResults ?? [];
  const unprocessed = res.unprocessedRecords ?? [];

  const summary = summarizeResults(successful, failed);
  const base = inputPath.replace(/\.csv$/i, "");
  const resultsPath = base + ".results.csv";
  writeRows(resultsPath, summary.rows, ["status", "id", "error"]);

  // 실패 행을 "재적재 가능한 원본 필드"로 저장 → 고친 뒤 다시 load 하면 됨(부분 실패 복구).
  let failedPath: string | undefined;
  if (failed.length > 0) {
    const failedRows = failed.map(stripResultMeta);
    failedPath = base + ".failed.csv";
    writeRows(failedPath, failedRows, unionHeaders(failedRows));
  }

  summarize("load", {
    입력: successful.length + failed.length + unprocessed.length,
    성공: summary.success,
    실패: summary.fail,
  });
  if (failed.length > 0) {
    console.warn(`실패 ${failed.length}건 → ${failedPath} 에 재적재용으로 저장됨. 원인은 ${resultsPath}에서 확인하고, 고친 뒤 'load'로 재시도하세요.`);
    if (job.operation === "insert") {
      console.warn("주의: insert는 재적재 시 중복 생성 위험이 있습니다. 반복 재시도가 필요하면 externalId 기반 upsert를 권장합니다(멱등).");
    }
  }
  return { success: summary.success, fail: summary.fail, resultsPath, failedPath };
}
