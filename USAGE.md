# sfload 사용 가이드 (단계별)

엑셀/CSV 데이터를 Salesforce에 넣을 때, **헤더 매핑 + lookup 필드의 Id 자동 채우기 + 검증**을 명령 몇 줄로 처리하는 방법을 처음부터 끝까지 안내합니다.

핵심 개념 한 줄: **CSV에는 "내부 Id" 대신 사람이 아는 업무 키만 넣으면, 도구가 org에서 실제 Id를 찾아 관계를 연결해 줍니다.**

---

## 0. 준비 (최초 1회만)

1. **Node.js 설치** (v20 권장) — 터미널에서 `node -v` 로 확인.
2. **이 저장소 받기 + 빌드**
   ```bash
   git clone https://github.com/yonzn0213/sf-lookup-loader.git
   cd sf-lookup-loader
   npm install
   npm run build
   ```
   이후 명령은 `node dist/cli.js ...` 로 실행합니다. (전역 설치를 원하면 `npm link` 후 `sfload ...`)
3. **Salesforce CLI 로그인** — 대상 org에 별칭(alias)을 붙여 로그인.
   ```bash
   sf org login web --alias dev
   ```
   - 이미 로그인돼 있으면 `sf org list` 로 별칭/username 확인.
   - 별칭에 공백이 있어도 됩니다(예: `"YG1 Partial"`).

> ❗ 도구는 비밀번호/토큰을 저장하지 않습니다. `sf` 로그인 세션을 빌려 씁니다.

---

## 1. 데이터(CSV) 준비

- 입력은 **CSV** 를 권장합니다(엑셀은 "다른 이름으로 저장 → CSV UTF-8"). 대용량 엑셀의 렉이 사라집니다.
- **헤더 이름은 자유**입니다. SF 필드명과 달라도 됩니다 — 다음 단계의 매핑에서 연결합니다.
- 값의 앞뒤 공백은 자동으로 정리됩니다(중간 공백은 유지). **중복된 헤더가 있으면 에러**로 알려줍니다.

예: `data.csv`
```
이름,이메일,거래처키
홍길동,hong@test.com,ACME-001
김영희,kim@test.com,ACME-002
```

---

## 2. 매핑 설정(job.json) 만들기

설정 파일은 **"어느 객체에, 어떤 헤더를 어떤 필드로 넣을지"** 를 정의합니다.

### 방법 A) 대화형 마법사 (추천)
```bash
node dist/cli.js init --org dev -i data.csv
```
→ 객체·작업 종류·각 CSV 헤더의 매핑(필드 / lookup / 건너뛰기)을 **목록에서 골라** job.json을 만듭니다.
- 모든 선택지는 org에서 불러와 검증되므로 오타·없는 필드 선택이 불가능합니다.
- lookup은 선택한 필드의 관계 대상이 자동 확정되고, 비교할 key 필드만 고르면 됩니다.
- 끝나면 **자동 dry-run**으로 "변환 N / 미매칭 K"를 보여줘 적재 전에 매핑을 검증합니다.

### 방법 B) 직접 작성
```jsonc
{
  "object": "Contact",            // 데이터를 넣을 대상 객체(API명)
  "targetOrg": "dev",             // sf 별칭 또는 username
  "operation": "insert",          // insert | update | upsert
  "skipEmptyFields": false,       // true면 빈 셀은 안 보냄(update에서 기존 값 보존)
  "onLookupMiss": "error",        // lookup 매칭 실패 시: error(행 제외) | blank(공란)
  "mappings": {
    "이름":   "LastName",          // 단순 매핑: "CSV헤더": "SF필드"
    "이메일": "Email",
    "거래처키": {                  // lookup 매핑: 키로 관계 레코드 Id를 찾아 채움
      "field": "AccountId",        //  → 채울 lookup 필드
      "lookup": { "object": "Account", "key": "External_Id__c" }  // 대상 객체 / 비교할 키 필드
    }
  }
}
```

**lookup 매핑이 핵심입니다.** 위 예에서 CSV의 `거래처키` 값으로 `Account`의 `External_Id__c`가 일치하는 레코드를 찾아, 그 Id를 `AccountId`에 넣습니다.

> 매핑에 없는 CSV 컬럼은 무시됩니다. `update`는 `Id` 매핑이, `upsert`는 `externalIdField`가 필요합니다.

---

## 2.5 사전 점검 — `check` (선택, CI 권장)

작성한 job.json이 org와 맞는지 **적재 없이** 미리 검사합니다(비대화형 → CI 파이프라인에 넣기 좋음).
```bash
node dist/cli.js check -c job.json
```
점검 항목: 객체·필드 존재, lookup 필드가 관계 필드인지 + 대상(referenceTo) 일치, key 필드 존재, operation별 필수(update→Id, upsert→externalIdField), **FLS/권한**(생성/수정 불가 필드 경고). 에러가 있으면 0이 아닌 종료코드로 끝나 CI가 잡습니다.

---

## 3. 변환 — `prepare` (적재하지 않음, 안전)

```bash
node dist/cli.js prepare -c job.json -i data.csv
```
결과:
- `data.resolved.csv` — 헤더가 SF 필드명으로 바뀌고 **lookup 값이 실제 Id로 치환된** 깨끗한 파일.
- `data.errors.csv` — 매칭 실패/중복 등 문제가 있는 행 목록(행번호·필드·값·사유).

콘솔에 `입력 N / 변환 M / 에러 K` 가 찍힙니다. **`errors.csv`를 먼저 확인**하고, 원본 데이터를 고쳐 다시 `prepare` 하세요. (적재 전이라 안전합니다.)

errors.csv 예:
```
row,field,key,reason
3,AccountId,ACME-999,미매칭     # 3행의 'ACME-999'에 맞는 Account가 없음
5,AccountId,ACME-002,중복 key   # 같은 키를 가진 Account가 2개 이상
```

---

## 4. 적재 — `load`

`resolved.csv`가 만족스러우면 적재합니다.
```bash
node dist/cli.js load -c job.json -i data.resolved.csv
```
결과:
- `data.resolved.results.csv` — 행별 성공/실패와 사유.
- **실패가 있으면 `data.resolved.failed.csv`** — 실패한 행만 **재적재 가능한 형태**(원본 필드만)로 저장됩니다.
- 콘솔에 `입력 N / 성공 S / 실패 F` 와 건수 대조.

**부분 실패 복구**: 일부만 실패하면 → `failed.csv`의 행을 고친 뒤 **그 파일로 다시 `load`** 하면 됩니다.
```bash
node dist/cli.js load -c job.json -i data.resolved.failed.csv
```
> ⚠️ **멱등성**: `insert`로 재적재하면 이미 성공한 행과 별개로 **중복 생성**될 수 있습니다(failed.csv엔 실패 행만 있으니 보통 안전하지만). 반복 재시도가 잦은 작업은 **externalId 기반 `upsert`** 를 쓰면 같은 데이터를 여러 번 돌려도 안전합니다(멱등).

> `resolved.csv`를 우리 도구로 적재하지 않고 **기존 Data Loader로 올려도** 됩니다(이미 Id가 채워진 파일이라).

> 입력 CSV는 메모리에 통째로 올리지 않고 **스트림으로 Bulk2에 투입**되어 대용량도 안정적입니다.

> 🧾 **감사 로그**: `load` 실행마다 `sfload-audit.log`(JSONL)에 시각·host·org·object·operation·성공/실패 건수가 한 줄씩 append됩니다.

### prepare + load 한 번에
```bash
node dist/cli.js run -c job.json -i data.csv
```
(단, `onLookupMiss: error`인데 에러가 있으면 적재를 멈추고 알려줍니다.)

---

## operation 3종 차이

| operation | 동작 | 필수 설정 |
|-----------|------|-----------|
| `insert` | 새 레코드 생성 | — |
| `update` | 기존 레코드 수정 | `Id`로 매핑되는 컬럼 |
| `upsert` | 있으면 수정, 없으면 생성 | `externalIdField` |

`update`/`upsert`에서 **빈 셀이 기존 값을 지우는 게 싫으면** `"skipEmptyFields": true`.

---

## 대용량(수십만 건) 팁

- 엑셀 말고 **CSV**로 내보내세요(엑셀이 못 버팁니다).
- `prepare`는 스트리밍이라 행 수가 많아도 메모리에 다 올리지 않습니다(메모리는 고유 key 수에 비례).
- lookup 조회는 key를 500개씩 묶어 처리합니다. 고유 key가 많으면 조회에 수 분이 걸릴 수 있습니다(정상).
- Bulk 적재는 서버에서 배치로 처리되어 수 분~수십 분 걸릴 수 있습니다.

---

## 자주 막히는 곳 (Troubleshooting)

| 증상 | 원인 / 해결 |
|------|-------------|
| `sf CLI 실행 실패` | `sf org list`로 별칭 확인, `sf org login web --alias <별칭>` 재로그인 |
| `잘못된 org 별칭` | 별칭에 `;` `&` `\|` 같은 셸 특수문자는 못 씀(공백은 OK) |
| `중복 헤더 발견` | CSV 헤더에 같은 이름이 2개 → 하나로 정리 |
| lookup `미매칭`이 많음 | key 값/대상 필드(`key`)가 맞는지 확인. 앞뒤 공백·대소문자는 자동 무시됨 |
| `중복 key` | 대상 객체에 같은 키 레코드가 여러 개 → 키 필드를 고유한 것으로 |
| `upsert에는 externalIdField가 필요` | job.json에 `externalIdField` 추가 |

---

명령별 도움말은 터미널에서: `node dist/cli.js --help`, `node dist/cli.js prepare --help`
