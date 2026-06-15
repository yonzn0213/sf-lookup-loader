import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCsv, assertUniqueHeaders } from "../src/csv";

const f = join(tmpdir(), "sfload_csv_test.csv");
afterEach(() => { if (existsSync(f)) rmSync(f); });

describe("assertUniqueHeaders", () => {
  it("고유 헤더는 통과", () => {
    expect(assertUniqueHeaders(["a", "b"])).toEqual(["a", "b"]);
  });
  it("중복 헤더는 throw", () => {
    expect(() => assertUniqueHeaders(["a", "b", "a"])).toThrow(/중복 헤더/);
  });
});

describe("readCsv", () => {
  it("앞뒤 공백 trim, 중간 공백 보존", async () => {
    writeFileSync(f, "name\n  홍 길동  \n", "utf8");
    const rows = await readCsv(f);
    expect(rows[0].name).toBe("홍 길동");
  });
  it("중복 헤더 CSV는 에러", async () => {
    writeFileSync(f, "a,a\n1,2\n", "utf8");
    await expect(readCsv(f)).rejects.toThrow(/중복 헤더/);
  });
});
