import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { stringify } from "csv-stringify";
import type { Connection } from "jsforce";
import type { Job, IdMap } from "./types.js";
import { parseMappings, applySimple } from "./mapping.js";
import { queryKeys, buildIdMap, resolveRow } from "./lookup.js";
import { summarize } from "./report.js";
import { streamCsvRows, readHeader } from "./csv.js";

// 2-pass 스트리밍: 입력 행을 메모리에 쌓지 않는다.
//  1패스 — lookup key만 수집 → org 일괄 조회로 key→Id 맵 구성
//  2패스 — 행을 다시 스트리밍하며 변환, 결과/에러를 스트리밍 기록
// 메모리는 "행 수"가 아니라 "고유 key 수"에만 비례한다.
export async function prepare(conn: Connection, job: Job, inputPath: string): Promise<{
  resolvedPath: string; errorsPath: string; resolvedCount: number; errorCount: number;
}> {
  const { simple, lookups } = parseMappings(job.mappings);

  // ── 매핑 소스 헤더 존재 검증(데이터 0행이어도 수행) ──
  // 매핑에 정의된 소스 헤더가 CSV에 없으면(오타 등) 조용히 빈 값 처리되어 원인을 숨김 → 조기 차단.
  const sourceHeaders = [...Object.keys(simple), ...lookups.map((l) => l.src)];
  const header = readHeader(inputPath);
  if (header.length > 0) {
    const present = new Set(header);
    const missing = sourceHeaders.filter((h) => !present.has(h));
    if (missing.length > 0)
      throw new Error(`매핑에 지정된 CSV 컬럼이 없습니다: ${missing.join(", ")} (CSV 헤더: ${header.join(", ")})`);
  }

  // ── 1패스: 고유 key 수집 ──
  const keySets: Record<string, Set<string>> = {};
  for (const lk of lookups) keySets[lk.field] = new Set();
  for await (const row of streamCsvRows(inputPath)) {
    for (const lk of lookups) {
      const v = (row[lk.src] ?? "").trim();
      if (v) keySets[lk.field].add(v);
    }
  }

  // ── 조회: key→Id 맵 ──
  const idMaps: Record<string, IdMap> = {};
  for (const lk of lookups) {
    const recs = await queryKeys(conn as any, lk.object, lk.key, [...keySets[lk.field]]);
    idMaps[lk.field] = buildIdMap(recs, lk.key);
  }

  // ── 출력 스트림 준비 ──
  const resolvedPath = inputPath.replace(/\.csv$/i, "") + ".resolved.csv";
  const errorsPath = inputPath.replace(/\.csv$/i, "") + ".errors.csv";
  const headers = [...Object.values(simple), ...lookups.map((l) => l.field)];

  const resolvedOut = createWriteStream(resolvedPath);
  const resolvedCsv = stringify({ header: true, columns: headers });
  resolvedCsv.pipe(resolvedOut);

  const errorsOut = createWriteStream(errorsPath);
  const errorsCsv = stringify({ header: true, columns: ["row", "field", "key", "reason"] });
  errorsCsv.pipe(errorsOut);

  // ── 2패스: 스트리밍 변환·기록 ──
  let resolvedCount = 0;
  let errorCount = 0;
  let rowNum = 1; // 헤더가 1행
  for await (const row of streamCsvRows(inputPath)) {
    rowNum++;
    const base = applySimple(row, simple, job.skipEmptyFields);
    const { fields, errors } = resolveRow(row, lookups, idMaps, job.onLookupMiss, rowNum);
    for (const e of errors) { errorsCsv.write(e); errorCount++; }
    if (job.onLookupMiss === "error" && errors.length > 0) continue;
    resolvedCsv.write({ ...base, ...fields });
    resolvedCount++;
  }

  resolvedCsv.end();
  errorsCsv.end();
  await Promise.all([finished(resolvedOut), finished(errorsOut)]);

  summarize("prepare", { 입력: rowNum - 1, 변환: resolvedCount, 에러: errorCount });
  return { resolvedPath, errorsPath, resolvedCount, errorCount };
}
