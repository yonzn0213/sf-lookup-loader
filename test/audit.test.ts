import { describe, it, expect } from "vitest";
import { buildAuditEntry } from "../src/audit";

describe("buildAuditEntry", () => {
  it("실행 정보를 감사 항목으로 구성(ts는 ISO)", () => {
    const e = buildAuditEntry(
      { org: "dev", object: "Contact", operation: "upsert", input: "a.csv", success: 10, fail: 2 },
      new Date("2026-06-17T01:02:03.000Z"),
    );
    expect(e.ts).toBe("2026-06-17T01:02:03.000Z");
    expect(e.org).toBe("dev");
    expect(e.object).toBe("Contact");
    expect(e.operation).toBe("upsert");
    expect(e.input).toBe("a.csv");
    expect(e.success).toBe(10);
    expect(e.fail).toBe(2);
    expect(typeof e.host).toBe("string");
  });
});
