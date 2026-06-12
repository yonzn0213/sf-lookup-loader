import { describe, it, expect, vi } from "vitest";
import { chunk, soqlEscape, buildIdMap, resolveRow, queryKeys } from "../src/lookup";

describe("chunk", () => {
  it("크기대로 분할", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("soqlEscape", () => {
  it("작은따옴표·백슬래시 이스케이프", () => {
    expect(soqlEscape("a'b\\c")).toBe("a\\'b\\\\c");
  });
  it("개행·탭 등 제어문자 이스케이프", () => {
    expect(soqlEscape("a\nb\tc")).toBe("a\\nb\\tc");
  });
});

describe("buildIdMap", () => {
  it("key→Id 맵 + 중복 감지", () => {
    const r = buildIdMap(
      [{ Id: "1", K: "a" }, { Id: "2", K: "b" }, { Id: "3", K: "b" }], "K");
    expect(r.map.get("a")).toBe("1");
    expect(r.duplicates.has("b")).toBe(true);
  });
});

const lookups = [{ src: "거래처키", field: "AccountId", object: "Account", key: "External_Id__c" }];

describe("resolveRow", () => {
  const idMaps = { AccountId: { map: new Map([["K1", "001x"]]), duplicates: new Set<string>() } };

  it("매칭되면 Id 치환", () => {
    const r = resolveRow({ "거래처키": "K1" }, lookups, idMaps, "error", 1);
    expect(r.fields).toEqual({ AccountId: "001x" });
    expect(r.errors).toEqual([]);
  });
  it("미매칭 + error면 에러 기록", () => {
    const r = resolveRow({ "거래처키": "X" }, lookups, idMaps, "error", 2);
    expect(r.errors[0]).toMatchObject({ row: 2, field: "AccountId", key: "X", reason: "미매칭" });
  });
  it("미매칭 + blank면 공란 + 에러 기록", () => {
    const r = resolveRow({ "거래처키": "X" }, lookups, idMaps, "blank", 3);
    expect(r.fields).toEqual({ AccountId: "" });
    expect(r.errors.length).toBe(1);
  });
  it("중복 key는 항상 에러", () => {
    const dup = { AccountId: { map: new Map(), duplicates: new Set(["D"]) } };
    const r = resolveRow({ "거래처키": "D" }, lookups, dup, "blank", 4);
    expect(r.errors[0].reason).toBe("중복 key");
  });
  it("빈 lookup 값은 스킵(에러 아님, 필드 미설정)", () => {
    const r = resolveRow({ "거래처키": "" }, lookups, idMaps, "error", 5);
    expect(r.fields).toEqual({});
    expect(r.errors).toEqual([]);
  });
});

describe("queryKeys", () => {
  it("청크별 SOQL 조회 결과 합침", async () => {
    const conn = { query: vi.fn()
      .mockResolvedValueOnce({ records: [{ Id: "1", K: "a" }] })
      .mockResolvedValueOnce({ records: [{ Id: "2", K: "b" }] }) };
    const recs = await queryKeys(conn as any, "Account", "K", ["a", "b"], 1);
    expect(recs).toHaveLength(2);
    expect(conn.query).toHaveBeenCalledTimes(2);
  });
});
