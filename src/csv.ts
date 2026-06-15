import { createReadStream } from "node:fs";
import { parse } from "csv-parse";

// 중복 헤더를 발견하면 에러. csv-parse는 기본적으로 뒤 컬럼이 앞을 덮어써(조용한 데이터 손실) 이를 막는다.
export function assertUniqueHeaders(header: string[]): string[] {
  const seen = new Set<string>();
  for (const h of header) {
    if (seen.has(h)) throw new Error(`중복 헤더 발견: '${h}'. CSV 헤더는 고유해야 합니다.`);
    seen.add(h);
  }
  return header;
}

// CSV를 읽어 행 배열로 반환. 값은 앞뒤 공백 trim(중간 공백 보존), BOM 처리, 중복 헤더 거부.
export async function readCsv(path: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const parser = createReadStream(path).pipe(
    parse({ columns: assertUniqueHeaders, bom: true, trim: true }),
  );
  for await (const rec of parser) rows.push(rec as Record<string, string>);
  return rows;
}
