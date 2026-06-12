import { describe, it, expect } from "vitest";
import { suggestMappings } from "../src/describe";

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
