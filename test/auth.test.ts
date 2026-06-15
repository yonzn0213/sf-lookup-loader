import { describe, it, expect } from "vitest";
import { parseOrgDisplay, isValidAlias } from "../src/auth";

describe("isValidAlias", () => {
  it("정상 별칭/username 허용 (공백 포함 별칭도 OK)", () => {
    expect(isValidAlias("dev")).toBe(true);
    expect(isValidAlias("my-sandbox.01")).toBe(true);
    expect(isValidAlias("user@example.com")).toBe(true);
    expect(isValidAlias("YG1 Partial")).toBe(true);
  });
  it("셸 메타문자 포함 별칭 거부(명령 인젝션 방지)", () => {
    expect(isValidAlias("dev && rm -rf ~")).toBe(false);
    expect(isValidAlias("dev`curl evil`")).toBe(false);
    expect(isValidAlias("dev; echo x")).toBe(false);
    expect(isValidAlias("dev|cat")).toBe(false);
  });
});

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
