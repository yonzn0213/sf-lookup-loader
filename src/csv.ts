import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";

// 중복 헤더를 발견하면 에러. csv-parse는 기본적으로 뒤 컬럼이 앞을 덮어써(조용한 데이터 손실) 이를 막는다.
export function assertUniqueHeaders(header: string[]): string[] {
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) throw new Error(`중복 헤더 발견: '${h}'. CSV 헤더는 고유해야 합니다.`);
    seen.add(h);
  }
  return header;
}

// CSV 헤더(첫 줄)만 읽어 배열로 반환. 데이터 0행이어도 동작. 중복 헤더는 거부.
// 스트림 대신 앞부분만 동기로 읽어(fd 즉시 닫음) Windows 파일 잠금/핸들 누수를 피한다. 대용량도 안전.
export function readHeader(path: string): string[] {
  const fd = openSync(path, "r");
  let text: string;
  try {
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    text = buf.toString("utf8", 0, n);
  } finally {
    closeSync(fd);
  }
  const nl = text.search(/\r?\n/);
  const line = nl === -1 ? text : text.slice(0, nl);
  if (line.trim() === "") return [];
  const rows = parseSync(line, { trim: true, bom: true }) as string[][];
  return assertUniqueHeaders(rows[0] ?? []);
}

// CSV를 행 단위로 스트리밍 yield. 전체를 메모리에 올리지 않음(대용량 대응).
// 값은 앞뒤 공백 trim(중간 공백 보존), BOM 처리, 중복 헤더 거부.
export async function* streamCsvRows(path: string): AsyncGenerator<Record<string, string>> {
  const parser = createReadStream(path).pipe(
    parse({ columns: assertUniqueHeaders, bom: true, trim: true }),
  );
  for await (const rec of parser) yield rec as Record<string, string>;
}

// 행 배열로 한 번에 읽기(소규모용). 내부적으로 스트리밍 제너레이터를 모은다.
export async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  for await (const rec of streamCsvRows(path)) rows.push(rec);
  return rows;
}
