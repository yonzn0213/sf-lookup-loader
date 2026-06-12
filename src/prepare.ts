import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type { Connection } from "jsforce";
import type { Job, IdMap, RowError } from "./types.js";
import { parseMappings, applySimple } from "./mapping.js";
import { queryKeys, buildIdMap, resolveRow } from "./lookup.js";
import { writeRows, writeErrors, summarize } from "./report.js";

async function readRows(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, trim: true }));
  for await (const rec of parser) rows.push(rec as Record<string, string>);
  return rows;
}

export async function prepare(conn: Connection, job: Job, inputPath: string): Promise<{
  resolvedPath: string; errorsPath: string; resolvedCount: number; errorCount: number;
}> {
  const { simple, lookups } = parseMappings(job.mappings);
  const rows = await readRows(inputPath);

  const idMaps: Record<string, IdMap> = {};
  for (const lk of lookups) {
    const keys = rows.map((r) => r[lk.src]).filter((v): v is string => !!v);
    const recs = await queryKeys(conn as any, lk.object, lk.key, keys);
    idMaps[lk.field] = buildIdMap(recs, lk.key);
  }

  const headers = [...Object.values(simple), ...lookups.map((l) => l.field)];
  const outRows: Record<string, string>[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, i) => {
    const rowNum = i + 2;
    const base = applySimple(row, simple);
    const { fields, errors: rowErrors } = resolveRow(row, lookups, idMaps, job.onLookupMiss, rowNum);
    errors.push(...rowErrors);
    if (job.onLookupMiss === "error" && rowErrors.length > 0) return;
    outRows.push({ ...base, ...fields });
  });

  const resolvedPath = inputPath.replace(/\.csv$/i, "") + ".resolved.csv";
  const errorsPath = inputPath.replace(/\.csv$/i, "") + ".errors.csv";
  writeRows(resolvedPath, outRows, headers);
  writeErrors(errorsPath, errors);
  summarize("prepare", { 입력: rows.length, 변환: outRows.length, 에러: errors.length });
  return { resolvedPath, errorsPath, resolvedCount: outRows.length, errorCount: errors.length };
}
