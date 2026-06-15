import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Connection } from "jsforce";

const pexec = promisify(exec);

// 셸 메타문자/제어문자만 차단(명령 인젝션 방지). 공백은 허용 — SF 별칭에 공백이 들어갈 수 있음(예: "YG1 Partial").
const DANGEROUS_IN_ALIAS = /["'`$;&|<>(){}\[\]!*?~\\\n\r\t]/;

export function isValidAlias(alias: string): boolean {
  return alias.length > 0 && !DANGEROUS_IN_ALIAS.test(alias);
}

export function parseOrgDisplay(stdout: string): { accessToken: string; instanceUrl: string } {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("sf org display 출력 파싱 실패"); }
  const r = parsed?.result ?? {};
  if (!r.accessToken || !r.instanceUrl)
    throw new Error("org 인증 정보를 찾지 못했습니다. `sf org login` 후 다시 시도하세요.");
  return { accessToken: r.accessToken, instanceUrl: r.instanceUrl };
}

export async function getConnection(alias: string): Promise<Connection> {
  if (!isValidAlias(alias))
    throw new Error(`잘못된 org 별칭: '${alias}'. 셸 특수문자는 쓸 수 없습니다.`);
  let stdout: string;
  try {
    // 별칭은 검증을 통과한 안전한 값이며, 공백 대응을 위해 큰따옴표로 감싼다.
    ({ stdout } = await pexec(`sf org display --target-org "${alias}" --json`));
  } catch {
    throw new Error(`sf CLI 실행 실패: '${alias}'가 로그인돼 있는지(\`sf org list\`) 확인하세요.`);
  }
  const { accessToken, instanceUrl } = parseOrgDisplay(stdout);
  return new Connection({ accessToken, instanceUrl });
}
