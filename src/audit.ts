import { appendFileSync } from "node:fs";
import { hostname } from "node:os";

// 적재 감사 로그 1건. "누가(host/org)·언제·무엇을(object/operation)·결과(건수)"를 남긴다.
export interface AuditEntry {
  ts: string;
  host: string;
  org: string;
  object: string;
  operation: string;
  input: string;
  success: number;
  fail: number;
}

export function buildAuditEntry(
  p: { org: string; object: string; operation: string; input: string; success: number; fail: number },
  now: Date,
): AuditEntry {
  return {
    ts: now.toISOString(),
    host: hostname(),
    org: p.org,
    object: p.object,
    operation: p.operation,
    input: p.input,
    success: p.success,
    fail: p.fail,
  };
}

// append-only JSONL. 한 줄 = 한 실행.
export function appendAudit(path: string, entry: AuditEntry): void {
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}
