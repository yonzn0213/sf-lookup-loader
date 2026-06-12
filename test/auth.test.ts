import { describe, it, expect } from "vitest";
import { parseOrgDisplay } from "../src/auth";

describe("parseOrgDisplay", () => {
  it("accessToken·instanceUrl 추출", () => {
    const json = JSON.stringify({ status: 0, result: { accessToken: "TOK", instanceUrl: "https://x.my.salesforce.com" } });
    expect(parseOrgDisplay(json)).toEqual({ accessToken: "TOK", instanceUrl: "https://x.my.salesforce.com" });
  });
  it("토큰 없으면 throw", () => {
    expect(() => parseOrgDisplay(JSON.stringify({ status: 0, result: {} }))).toThrow();
  });
  it("비-JSON이면 throw", () => {
    expect(() => parseOrgDisplay("not json")).toThrow();
  });
});
