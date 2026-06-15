import { describe, it, expect } from "vitest";
import { suggestMappings } from "../src/describe";
import { toFieldInfo } from "../src/describe";

describe("toFieldInfo", () => {
  it("describe 필드를 FieldInfo로 정규화", () => {
    const f = toFieldInfo({
      name: "AccountId", label: "거래처", type: "reference",
      referenceTo: ["Account"], createable: true, updateable: true,
      nillable: false, defaultedOnCreate: false, externalId: false, idLookup: false,
    });
    expect(f).toEqual({
      name: "AccountId", label: "거래처", type: "reference", referenceTo: ["Account"],
      createable: true, updateable: true, nillable: false,
      defaultedOnCreate: false, externalId: false, idLookup: false,
    });
  });
  it("누락 필드는 안전한 기본값", () => {
    const f = toFieldInfo({ name: "X" });
    expect(f.label).toBe("X");
    expect(f.referenceTo).toEqual([]);
    expect(f.createable).toBe(false);
  });
});

describe("suggestMappings", () => {
  it("소스 헤더를 라벨/이름으로 매칭, 못 찾으면 빈 문자열", () => {
    const fields = [
      { name: "LastName", label: "성" },
      { name: "Email", label: "이메일" },
    ];
    const out = suggestMappings(["이메일", "성", "미상"], fields as any);
    expect(out).toEqual({ "이메일": "Email", "성": "LastName", "미상": "" });
  });
});
