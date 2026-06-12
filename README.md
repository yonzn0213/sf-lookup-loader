# sfload — Salesforce 데이터 마이그레이션 CLI

엑셀/CSV 데이터를 Salesforce에 **insert / update / upsert** 할 때 반복되는 노가다 — **헤더 매핑, lookup 필드의 key→레코드 Id 자동 치환, 검증 리포트** — 를 처리하는 로컬 CLI.

> 데이터 삽입 마이그레이션 실무의 세 가지 통점(① lookup Id 수작업 매핑 ② 대용량 엑셀 렉 ③ 검증 번거로움)을 직접 겪고 만든 도구입니다.

---

## ✨ 특징

- **헤더 매핑**: 소스 헤더(예: `이름`)를 SF API 필드(`LastName`)로 자동 변환. 설정 파일로 재사용.
- **lookup Id 자동 치환**: lookup 필드에 비즈니스 key를 주면, org에서 `SELECT Id ... WHERE key IN (...)`로 **일괄 조회**해 실제 레코드 Id로 치환. 엑셀 VLOOKUP 수작업 제거.
- **안전한 2단계**: `prepare`(매핑+치환, 적재 안 함)와 `load`(Bulk 적재)를 분리 — 적재 전에 결과·에러를 확인.
- **검증 리포트**: 미매칭/중복 key를 `errors.csv`로, 적재 결과(행별 성공/실패)를 `results.csv`로, 건수 대조를 콘솔로.
- **인증 비저장**: Salesforce CLI(`sf`) 로그인 세션을 재사용 — 비밀번호/토큰을 도구에 저장하지 않음.

---

## 🧩 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | Node 20, TypeScript (ESM) |
| SF 연동 | jsforce v3 (SOQL, Bulk API 2.0, describe) |
| 인증 | `sf org display --json` 재사용 → jsforce Connection |
| CSV | csv-parse (스트림 파싱) / csv-stringify |
| CLI | commander |
| 테스트 | Vitest (30 tests, TDD) |

---

## 🏗 아키텍처 / 파이프라인

```
job.json(매핑·operation) + data.csv
        │
   ┌────▼──────────────────────────── prepare ──────────────────────────┐
   │ 1. 헤더 매핑(소스→API 필드)                                          │
   │ 2. lookup key 수집 → org 일괄 조회(청크) → key→Id 맵                  │
   │ 3. 행별 치환 → resolved.csv  +  미매칭/중복 → errors.csv             │
   └─────────────────────────────────────────────────────────────────────┘
        │ (확인 후)
   ┌────▼──── load ────┐
   │ Bulk2 insert/      │ → results.csv (행별 성공/실패) + 건수 대조
   │ update/upsert      │
   └────────────────────┘
```

모듈은 **순수 변환부**(`config`·`mapping`·`lookup`·`report`)와 **IO부**(`auth`·`prepare`·`load`·`describe`)로 분리해 테스트 용이성을 확보했습니다.

---

## 🚀 시작하기

```bash
npm install && npm run build

# Salesforce CLI에 org 로그인 (별칭 부여)
sf org login web --alias dev

# 1) 매핑 설정 뼈대 생성 (org 필드로 헤더 자동 제안)
node dist/cli.js init -o Contact --org dev -i data.csv

# 2) 헤더 매핑 + lookup Id 치환 (적재 안 함, 안전)
node dist/cli.js prepare -c job.json -i data.csv     # → data.resolved.csv + data.errors.csv

# 3) Bulk 적재 + 결과 리포트
node dist/cli.js load -c job.json -i data.resolved.csv   # → data.resolved.results.csv

# prepare + load 한 번에
node dist/cli.js run -c job.json -i data.csv
```
> `npm link` 또는 전역 설치하면 `sfload <command>`로 바로 쓸 수 있습니다.

---

## ⚙️ 설정 파일 (`job.json`)

```jsonc
{
  "object": "Contact",            // 대상 SObject
  "targetOrg": "dev",             // sf CLI 별칭(영문/숫자/._@- 만 허용)
  "operation": "upsert",          // "insert" | "update" | "upsert"
  "externalIdField": "Ext__c",    // upsert일 때 필수
  "mappings": {
    "이름":   "LastName",          // 단순 매핑: 소스헤더 → API 필드
    "이메일": "Email",
    "거래처키": {                  // lookup 매핑: key로 관계 레코드 Id 치환
      "field": "AccountId",
      "lookup": { "object": "Account", "key": "External_Id__c" }
    }
  },
  "onLookupMiss": "error"         // "error"(미매칭 행 제외+리포트) | "blank"(공란 두고 진행)
}
```

규칙:
- 매핑 값이 **문자열**이면 단순 헤더 변환, **객체**면 lookup 해소.
- `update`는 `Id`로 매핑되는 컬럼이, `upsert`는 `externalIdField`가 필요(설정 검증에서 강제).
- 매핑에 없는 소스 컬럼은 출력에서 제외. **빈 lookup 값**은 관계 없음으로 간주해 스킵(에러 아님).

---

## 💡 기술적 의사결정

1. **`prepare`/`load` 분리** — 적재는 되돌리기 어렵다. 치환 결과와 미매칭 리포트를 먼저 확인한 뒤 적재하도록 단계를 분리했다. `prepare`만 써서 깨끗한 CSV를 뽑아 기존 Data Loader로 올리는 사용법도 1급 지원.
2. **`sf` CLI 인증 재사용** — 비밀번호/토큰을 도구에 저장하지 않기 위해 `sf org display --json`으로 accessToken만 받아 jsforce에 연결. 멀티 org를 별칭으로 전환.
3. **lookup 일괄 조회** — key를 행마다 조회하지 않고 전부 모아 청크(기본 500개) `IN` 쿼리로 한 번에 → API 호출 최소화. 중복/미매칭은 별도 리포트.
4. **보안** — org 별칭을 화이트리스트(`^[A-Za-z0-9._@-]+$`)로 검증해 셸 명령 인젝션 차단. SOQL 문자열 key는 따옴표·백슬래시·제어문자까지 이스케이프.
5. **테스트 설계** — IO(jsforce/파일)와 순수 로직을 분리해, 매핑·치환·검증·설정 검증을 순수 함수 단위 테스트로 커버(jsforce는 mock).

---

## ✅ 테스트

```bash
npm test          # vitest 30 tests
npx tsc --noEmit  # 타입 체크 (strict)
```
커버리지: 설정 검증, 헤더 매핑, lookup 치환(매칭/미매칭/중복/빈값), 청크 조회, SOQL 이스케이프(인젝션·제어문자), 별칭 검증, prepare 파이프라인(임시 CSV + mock), Bulk 옵션·결과 집계, 매핑 자동 제안.

---

## 📋 검증 결과 & 검토 사항 (Items)

> 자동 검증 + 코드 리뷰(에이전트) 결과와, **사용자 결정/후속이 필요한 항목**을 정리합니다.

### 검증 결과 (완료)
- ✅ vitest 30개 전부 통과, `tsc --noEmit` 무에러, `node dist/cli.js --help` 정상 구동.
- ✅ 런타임(prod) 의존성 취약점 0건 (`npm audit --omit=dev`). dev 도구(vitest/tsx 등) 경고는 배포물 무관.
- ✅ 코드 리뷰 지적 중 **보안/정확성 핵심 수정 완료**:
  - 별칭 명령 인젝션 차단(화이트리스트 검증)
  - SOQL 이스케이프에 제어문자(개행·탭 등) 포함
  - 빈 lookup 값이 오류로 처리되던 문제 → 스킵으로 수정

### 검토가 필요한 항목 (사용자 판단)
1. **수동 종단 테스트 (권장)**: 실제 sandbox 별칭으로 `init → prepare → load`(+upsert 1회) 소량 데이터 검증이 남았습니다. org가 있어야 가능해 자동화하지 못했습니다.
2. **저장소 공개 범위**: 현재 **public**(포트폴리오용)으로 생성. private 전환은 `gh repo edit yonzn0213/sfload --visibility private`.
3. **저장소 이름**: `sfload`로 생성. 변경 원하면 GitHub Settings에서 rename.
4. **update 시 빈 셀 동작**: 현재 단순 매핑의 빈 문자열은 그대로 전송돼 **update에서 기존 값을 null로 덮어쓸 수 있음**. "빈 값은 건너뛰기" 옵션이 필요한지 결정 필요.
5. **중복 헤더 CSV**: `csv-parse`가 중복 헤더 시 뒤 컬럼으로 조용히 덮어씀. 경고/거부 추가 여부.
6. **대용량 한계**: 현재 입력을 메모리에 적재(스트림 파싱+배열 보관). 수십만 행 이상은 OOM 위험 → 필요 시 2-pass 순수 스트리밍으로 확장.
7. **lookup key 정규화**: 공백/대소문자 차이로 미매칭 가능. trim/대소문자 무시 옵션 추가 여부.

위 4~7은 실제 사용 패턴을 보고 우선순위를 정하면 됩니다. 원하시는 항목을 알려주시면 후속 작업으로 처리합니다.

---

## License

MIT
