import { stringify } from "csv-stringify/sync";
import { writeFileSync } from "node:fs";
import type { RowError } from "./types.js";

export function writeRows(path: string, rows: Array<Record<string, string>>, headers: string[]): void {
  writeFileSync(path, stringify(rows, { header: true, columns: headers }), "utf8");
}

export function writeErrors(path: string, errors: RowError[]): void {
  writeFileSync(path, stringify(errors, { header: true, columns: ["row", "field", "key", "reason"] }), "utf8");
}

export function summarize(label: string, nums: Record<string, number>): void {
  const parts = Object.entries(nums).map(([k, v]) => `${k} ${v}`).join(" / ");
  console.log(`[${label}] ${parts}`);
}
