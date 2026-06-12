import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Connection } from "jsforce";

const pexec = promisify(execFile);

export function parseOrgDisplay(stdout: string): { accessToken: string; instanceUrl: string } {
  let parsed: any;
  try { parsed = JSON.parse(stdout); } catch { throw new Error("sf org display 출력 파싱 실패"); }
  const r = parsed?.result ?? {};
  if (!r.accessToken || !r.instanceUrl)
    throw new Error("org 인증 정보를 찾지 못했습니다. `sf org login` 후 다시 시도하세요.");
  return { accessToken: r.accessToken, instanceUrl: r.instanceUrl };
}

export async function getConnection(alias: string): Promise<Connection> {
  let stdout: string;
  try {
    ({ stdout } = await pexec("sf", ["org", "display", "--target-org", alias, "--json"], { shell: true }));
  } catch {
    throw new Error(`sf CLI 실행 실패: '${alias}' 별칭이 로그인돼 있는지(\`sf org list\`) 확인하세요.`);
  }
  const { accessToken, instanceUrl } = parseOrgDisplay(stdout);
  return new Connection({ accessToken, instanceUrl });
}
