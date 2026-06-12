#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { loadJob } from "./config.js";
import { getConnection } from "./auth.js";
import { prepare } from "./prepare.js";
import { load } from "./load.js";
import { describeFields, suggestMappings } from "./describe.js";

const program = new Command();
program.name("sfload").description("Salesforce 데이터 삽입 마이그레이션 CLI");

program.command("init")
  .requiredOption("-o, --object <name>")
  .requiredOption("--org <alias>")
  .option("-i, --input <csv>", "헤더 자동 제안용 샘플 CSV")
  .option("--out <path>", "출력 job 파일", "job.json")
  .action(async (opts) => {
    const conn = await getConnection(opts.org);
    const fields = await describeFields(conn, opts.object);
    let mappings: Record<string, string> = {};
    if (opts.input) {
      const header = await firstHeader(opts.input);
      mappings = suggestMappings(header, fields);
    }
    const job = { object: opts.object, targetOrg: opts.org, operation: "insert", mappings, onLookupMiss: "error" };
    writeFileSync(opts.out, JSON.stringify(job, null, 2) + "\n", "utf8");
    console.log(`job 파일 생성: ${opts.out} (필드 ${fields.length}개 기준)`);
  });

program.command("prepare")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await prepare(conn, job, opts.input);
    if (r.errorCount > 0) process.exitCode = 1;
  });

program.command("load")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
  .action(async (opts) => {
    const job = loadJob(opts.config);
    const conn = await getConnection(job.targetOrg);
    const r = await load(conn, job, opts.input);
    if (r.fail > 0) process.exitCode = 1;
  });

program.command("run")
  .requiredOption("-c, --config <job.json>")
  .requiredOption("-i, --input <csv>")
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

async function firstHeader(path: string): Promise<string[]> {
  const parser = createReadStream(path).pipe(parse({ to_line: 1, bom: true, trim: true }));
  for await (const rec of parser) return rec as string[];
  return [];
}

program.parseAsync();
