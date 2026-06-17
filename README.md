# sfload — Salesforce 데이터 마이그레이션 CLI

엑셀/CSV 데이터를 Salesforce에 **insert / update / upsert** 할 때 반복되는 노가다 — **헤더 매핑, lookup 필드의 key→레코드 Id 자동 치환, 검증 리포트** — 를 처리하는 로컬 CLI.

> 데이터 삽입 마이그레이션 실무의 세 가지 통점(① lookup Id 수작업 매핑 ② 대용량 엑셀 렉 ③ 검증 번거로움)을 직접 겪고 만든 도구입니다. (저장소: `sf-lookup-loader`, CLI 명령: `sfload`)

---

## ✨ 특징

- **헤더 매핑**: 소스 헤더(예: `이름`)를 SF API 필드(`LastName`)로 자동 변환. 설정 파일로 재사용.
- **lookup Id 자동 치환**: lookup 필드에 비즈니스 key를 주면, org에서 `SELECT Id ... WHERE key IN (...)`로 **일괄 조회**해 실제 레코드 Id로 치환. 엑셀 VLOOKUP 수작업 제거. key는 **앞뒤 공백·대소문자를 무시**하고 매칭(중간 공백은 보존).
- **대용량 스트리밍**: `prepare`는 입력을 **2-pass 스트리밍**으로 처리해 행을 메모리에 쌓지 않음 — 메모리가 *행 수가 아니라 고유 key 수*에만 비례. 수십만 행도 무렉.
- **안전한 2단계**: `prepare`(매핑+치환, 적재 안 함)와 `load`(Bulk 적재)를 분리 — 적재 전에 결과·에러를 확인.
- **검증 리포트**: 미매칭/중복 key를 `errors.csv`로, 적재 결과(행별 성공/실패)를 `results.csv`로, 건수 대조를 콘솔로.
- **대화형 `init` 마법사**: org 필드를 **목록에서 선택**해 매핑 설정을 만들고(오타·미존재 필드 선택 불가), lookup 대상 객체는 자동 확정. 끝나면 **자동 dry-run**으로 검증.
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
| 테스트 | Vitest (65 tests, TDD) |

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

모듈은 **순수 변환부**(`config`·`mapping`·`lookup`·`csv`·`report`)와 **IO부**(`auth`·`prepare`·`load`·`describe`)로 분리해 테스트 용이성을 확보했습니다.

---

## 🚀 시작하기

> 📖 **처음 쓰신다면 [단계별 사용 가이드 USAGE.md](USAGE.md)** 를 보세요 — 준비부터 에러 고치는 법까지 안내합니다.

```bash
npm install && npm run build

# Salesforce CLI에 org 로그인 (별칭 부여)
sf org login web --alias dev

# 1) 대화형 마법사로 매핑 설정 생성 (객체는 대화형 선택)
node dist/cli.js init --org dev -i data.csv

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
  "skipEmptyFields": false,       // true면 빈 셀은 출력에서 제외(update 시 기존 값 null 덮어쓰기 방지)
  "onLookupMiss": "error",        // "error"(미매칭 행 제외+리포트) | "blank"(공란 두고 진행)
  "mappings": {
    "이름":   "LastName",          // 단순 매핑: 소스헤더 → API 필드
    "이메일": "Email",
    "거래처키": {                  // lookup 매핑: key로 관계 레코드 Id 치환
      "field": "AccountId",
      "lookup": { "object": "Account", "key": "External_Id__c" }
    }
  }
}
```

규칙:
- 매핑 값이 **문자열**이면 단순 헤더 변환, **객체**면 lookup 해소.
- `update`는 `Id`로 매핑되는 컬럼이, `upsert`는 `externalIdField`가 필요(설정 검증에서 강제).
- 매핑에 없는 소스 컬럼은 출력에서 제외. **빈 lookup 값**은 관계 없음으로 간주해 스킵(에러 아님).
- 모든 CSV 값은 앞뒤 공백이 trim됩니다(중간 공백 보존). **중복 헤더가 있으면 에러**로 중단합니다.
- `skipEmptyFields: true`면 단순 매핑의 빈/공백 셀을 출력에서 빼서, update가 기존 값을 null로 덮어쓰지 않게 합니다.

---

## 🧪 실전 예시 — lookup으로 관계(Id) 자동 채우기

**상황**: `A` 객체에 `Test__c` 객체를 가리키는 lookup 필드 `Test__c`가 있고, `Test__c` 객체에는 고유 키 `KEY__c`가 있다. 마이그레이션 CSV에는 A의 필드들과 함께 **`Test OBJECT KEY`** 컬럼(연결할 Test 레코드의 `KEY__c` 값)이 들어 있다.

**원하는 것**: `Test OBJECT KEY` 값으로 Test 객체에서 `KEY__c`가 일치하는 레코드의 Id를 찾아 A의 lookup 필드 `Test__c`에 넣기.

```jsonc
{
  "object": "A",
  "targetOrg": "YG1 Partial",
  "operation": "insert",
  "mappings": {
    "이름": "Name",                                          // A의 일반 필드
    "Test OBJECT KEY": {                                     // CSV 컬럼명
      "field": "Test__c",                                    // → A의 lookup 필드(여기에 Id가 채워짐)
      "lookup": { "object": "Test__c", "key": "KEY__c" }     // 대상 객체 / 비교할 키 필드
    }
  }
}
```

**처리 흐름**:
`prepare` → `SELECT Id, KEY__c FROM Test__c WHERE KEY__c IN ( ...CSV의 'Test OBJECT KEY' 값들... )` 로 일괄 조회 → 값이 일치하는 Test 레코드의 **Id를 A의 `Test__c`에 자동 치환** → `data.resolved.csv` 생성(일치 안 되면 `data.errors.csv`). 이어서 `load`로 적재.

> 즉 CSV에는 "내부 Id"가 아니라 사람이 아는 **업무 키(KEY__c 값)** 만 넣으면, 도구가 실제 Id를 찾아 관계를 연결해 줍니다.

---

## 💡 기술적 의사결정

1. **`prepare`/`load` 분리** — 적재는 되돌리기 어렵다. 치환 결과와 미매칭 리포트를 먼저 확인한 뒤 적재하도록 단계를 분리했다. `prepare`만 써서 깨끗한 CSV를 뽑아 기존 Data Loader로 올리는 사용법도 1급 지원.
2. **`sf` CLI 인증 재사용** — 비밀번호/토큰을 도구에 저장하지 않기 위해 `sf org display --json`으로 accessToken만 받아 jsforce에 연결. 멀티 org를 별칭으로 전환.
3. **lookup 일괄 조회 + key 정규화** — key를 행마다 조회하지 않고 전부 모아 청크(기본 500개) `IN` 쿼리로 한 번에 → API 호출 최소화. 매칭 시 앞뒤 공백·대소문자를 무시해 사소한 차이로 인한 미매칭을 줄이고, 중복/미매칭은 별도 리포트.
4. **보안** — org 별칭을 화이트리스트(`^[A-Za-z0-9._@-]+$`)로 검증해 셸 명령 인젝션 차단. SOQL 문자열 key는 따옴표·백슬래시·제어문자까지 이스케이프.
5. **테스트 설계** — IO(jsforce/파일)와 순수 로직을 분리해, 매핑·치환·검증·설정·CSV 파싱을 순수 함수 단위 테스트로 커버(jsforce는 mock).

---

## ✅ 테스트

```bash
npm test          # vitest 65 tests
npx tsc --noEmit  # 타입 체크 (strict)
```
커버리지: 설정 검증(빈값 옵션 포함), 헤더 매핑, lookup 치환(매칭/미매칭/중복/빈값/공백·대소문자), 청크 조회, SOQL 이스케이프(인젝션·제어문자), 별칭 검증, CSV(중복 헤더 에러·trim), prepare 파이프라인(임시 CSV + mock), Bulk 옵션·결과 집계, 매핑 자동 제안.

---

## 📋 검증 결과 & 남은 사항

> 🧭 **현황·결정 로그·리뷰 처리 내역·GUI 방향 분석**은 [`docs/PROJECT-STATUS.md`](docs/PROJECT-STATUS.md)에 정리되어 있습니다(이어서 작업할 때 먼저 보세요).

### 검증 (완료)
- ✅ vitest **65개 전부 통과**, `tsc --noEmit` 무에러, `node dist/cli.js --help` 정상 구동.
- ✅ **대화형 `init` 마법사** — org 메타데이터 기반 목록 선택·검증, lookup 대상 자동 확정, 저장 후 자동 dry-run.
- ✅ 런타임(prod) 의존성 취약점 **0건** (`npm audit --omit=dev`; form-data 취약점 패치 완료).
- ✅ **실제 sandbox 종단 테스트 통과** — Account 부모/자식 생성 시 lookup key→ParentId 자동 치환·관계 형성 확인 후 테스트 레코드 정리(생성한 것만 삭제).
- ✅ 코드 리뷰 후 보안/정확성 수정: 별칭 명령 인젝션 차단, SOQL 제어문자 이스케이프, 빈 lookup 값 스킵.
- ✅ 추가 반영: `skipEmptyFields` 옵션, **중복 헤더 에러**, lookup key **앞뒤 공백·대소문자 정규화**, **공백 포함 org 별칭 지원**.
- ✅ **prepare 2-pass 스트리밍** + **load 입력 스트리밍** — 입력 행을 메모리에 쌓지 않음(prepare 메모리 = 고유 key 수에 비례, load는 CSV 파일 스트림을 Bulk2에 직접 투입).
- ✅ **부분 실패 복구** — 적재 실패 행을 재적재 가능한 `*.failed.csv`로 저장(고쳐서 다시 `load`). 반복 재시도엔 externalId 기반 **upsert(멱등)** 안내.
- ✅ **audit log** — `load` 실행마다 시각·host·org·object·operation·성공/실패 건수를 `sfload-audit.log`(JSONL, append-only)에 기록.
- ✅ **`check` 커맨드** — job.json을 org에 대해 **비대화형 사전 점검**(필드/관계/key 존재, referenceTo 일치, operation별 필수, **FLS/권한 경고**). 적재·쓰기 없음 → CI 프리플라이트.
- ✅ **다중 lookup** — 한 job에서 서로 다른 객체를 가리키는 lookup 여러 개를 동시에 해소.

### 남은 사항 (별도 결정 필요)
- **GUI/웹 UI** — 비개발 어드민·BA 진입용. 별도 제품(웹앱·호스팅·사용자별 OAuth)이라 **별도 전략·결정 필요**. 평가도 CLI 포지셔닝 유지를 권고.
- (성능, 선택) prepare 단일 패스(윈도우) 최적화 / load **결과** 스트리밍 — 현재도 입력 메모리 목표는 달성. 결과 배열 버퍼링이 문제될 초대용량에서만 고려.
- 다객체 **체인** lookup(lookup의 key를 또 다른 lookup으로 해소) — 수요 시 검토(YAGNI).

---

## License

MIT
