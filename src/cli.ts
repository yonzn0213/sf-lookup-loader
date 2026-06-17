#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { loadJob } from "./config.js";
import { getConnection } from "./auth.js";
import { prepare } from "./prepare.js";
import { load } from "./load.js";
import { runWizard } from "./wizard.js";
import { describeFields, type FieldInfo } from "./describe.js";
import { checkJob } from "./check.js";
import { assertUniqueHeaders } from "./csv.js";

const program = new Command();
program.name("sfload").description("Salesforce 데이터 삽입 마이그레이션 CLI (헤더 매핑 · lookup Id 자동 치환 · 검증)");

program.addHelpText("after", `
사용 흐름:
  $ sf org login web --alias dev                  # 1) org 로그인 (최초 1회)
  $ sfload init --org dev -i data.csv             # 2) 대화형 마법사로 매핑 설정(job.json) 생성
  $ sfload prepare -c job.json -i data.csv        # 3) 매핑+lookup 치환 (적재 X, 안전)
  $ sfload load -c job.json -i data.resolved.csv  # 4) Bulk 적재
  $ sfload run -c job.json -i data.csv            # (3+4 한 번에)

자세한 단계별 안내는 저장소의 USAGE.md 를 참고하세요.`);

program.command("init")
  .description("대화형 마법사로 매핑 설정(job.json) 생성 + dry-run 검증")
  .requiredOption("--org <alias>", "sf CLI 별칭 또는 username")
  .requiredOption("-i, --input <csv>", "매핑할 마이그레이션 CSV(헤더 사용)")
  .option("--out <path>", "출력 job 파일 경로", "job.json")
  .action(async (opts) => {
    const conn = await getConnection(opts.org);
    const headers = await firstHeader(opts.input);
    if (headers.length === 0) throw new Error("CSV 헤더를 읽지 못했습니다.");
    assertUniqueHeaders(headers); // 중복 헤더는 마법사 진입 전에 차단(조용한 데이터 손실 방지)
    const job = await runWizard(conn, headers, opts.org);
    writeFileSync(opts.out, JSON.stringify(job, null, 2) + "\n", "utf8");
    console.log(`\n✅ ${opts.out} 생성. dry-run으로 매핑을 검증합니다...\n`);
    const r = await prepare(conn, job, opts.input);
    console.log(`dry-run 결과: 변환 ${r.resolvedCount} / 미매칭 ${r.errorCount} (상세: ${r.errorsPath})`);
    console.log("문제 없으면 'load'로 적재하세요. (적재 전까지 org에 쓰기 없음)");
  });

program.command("prepare")
  .description("헤더 매핑 + lookup Id 치환 → *.resolved.csv / *.errors.csv (적재 안 함)")
  .requiredOption("-c, --config <job.json>", "매핑 설정 파일")
  .requiredOption("-i, --input <csv>", "입력 CSV")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await prepare(conn, job, opts.input);
    if (r.errorCount > 0) process.exitCode = 1;
  });

program.command("load")
  .description("CSV를 Bulk API로 적재(insert/update/upsert) → *.results.csv")
  .requiredOption("-c, --config <job.json>", "매핑 설정 파일")
  .requiredOption("-i, --input <csv>", "적재할 CSV (보통 *.resolved.csv)")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await load(conn, job, opts.input);
    if (r.fail > 0) process.exitCode = 1;
  });

program.command("run")
  .description("prepare + load 를 한 번에 실행")
  .requiredOption("-c, --config <job.json>", "매핑 설정 파일")
  .requiredOption("-i, --input <csv>", "입력 CSV")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const p = await prepare(conn, job, opts.input);
    if (p.errorCount > 0 && job.onLookupMiss === "error") {
      console.error("prepare 단계 에러가 있어 load를 중단합니다. errors.csv 확인.");
      process.exitCode = 1; return;
    }
    const r = await load(conn, job, p.resolvedPath);
    if (r.fail > 0) process.exitCode = 1;
  });

program.command("check")
  .description("job.json을 org에 대해 사전 점검(필드·관계·권한, 적재/쓰기 없음 — CI 프리플라이트)")
  .requiredOption("-c, --config <job.json>", "매핑 설정 파일")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    let objectFields: FieldInfo[];
    const targets: Record<string, FieldInfo[]> = {};
    try {
      objectFields = await describeFields(conn, job.object);
      for (const m of Object.values(job.mappings)) {
        if (typeof m !== "string" && !targets[m.lookup.object]) {
          targets[m.lookup.object] = await describeFields(conn, m.lookup.object);
        }
      }
    } catch (e) {
      console.error(`org 메타데이터 조회 실패: ${e instanceof Error ? e.message : e}. 객체명/권한을 확인하세요.`);
      process.exitCode = 1;
      return;
    }
    const issues = checkJob(job, objectFields, targets);
    if (issues.length === 0) { console.log("✅ 점검 통과: 문제 없음."); return; }
    for (const i of issues) console.log(`${i.level === "error" ? "❌" : "⚠️"} ${i.message}`);
    const errors = issues.filter((i) => i.level === "error").length;
    console.log(`\n점검 결과: 에러 ${errors} / 경고 ${issues.length - errors}`);
    if (errors > 0) process.exitCode = 1;
  });

async function firstHeader(path: string): Promise<string[]> {
  const parser = createReadStream(path).pipe(parse({ to_line: 1, bom: true, trim: true }));
  for await (const rec of parser) return rec as string[];
  return [];
}

program.parseAsync().catch((err) => {
  // 모든 핸들러 예외의 최종 경계: 스택트레이스 대신 사람이 읽는 메시지 + 비정상 종료코드.
  console.error(`실패: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
