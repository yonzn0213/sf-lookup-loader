# sfload — Salesforce 데이터 삽입 마이그레이션 CLI 설계

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 plan 대기)

## 배경

Salesforce 데이터 마이그레이션(주로 **데이터 삽입**) 작업의 반복 노가다를 줄이는 로컬 CLI. 현재 워크플로:
1. 엑셀/CSV 데이터를 전달받음
2. 헤더명을 SF API 필드명으로 수동 변경
3. lookup 필드는 주어진 **key값**으로 org에서 실제 레코드 **Id를 조회해 치환**(엑셀 VLOOKUP 노가다)
4. Data Loader 등으로 적재
5. 결과 검증

통점: ① lookup Id 매핑 수작업 ② 큰 엑셀 처리 시 렉 ③ 검증 번거로움. 이를 자동화한다.

## 목표 / 비목표

**목표**
- 헤더 매핑(소스 → SF API 필드) 설정으로 자동 변환, 재사용
- lookup 필드를 key→Id 일괄 조회로 자동 치환 + 미매칭/중복 리포트
- 대용량 CSV를 **스트리밍**으로 처리(메모리·렉 문제 해소)
- `insert` / `update` / `upsert` 지원(Bulk API)
- 적재 결과(행별 성공/실패) + 건수 대조 검증 리포트
- `sf` CLI 인증 재사용(자격증명 비저장)

**비목표 (YAGNI)**
- GUI/웹 화면(차후 별도)
- delete/hard delete, 객체 간 자동 의존성 정렬(향후 확장)
- 양방향 동기화, 스케줄링
- xlsx 고급 기능(권장 입력은 CSV; xlsx는 단순 변환만 옵션)

## 핵심 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 형태 | 로컬 Node + TypeScript CLI | 사용자 스킬 적합, 스트리밍·자동화·포트폴리오 |
| SF 연동 | `jsforce` | 표준 라이브러리, Bulk·SOQL·describe 지원 |
| 인증 | `sf org display --target-org <alias> --json` 재사용 | 비밀번호/토큰 비저장, 멀티 org alias |
| 입력 | CSV(스트리밍) 권장, `.xlsx`는 변환 옵션 | 대용량 렉 해결의 핵심 |
| 적재 | Bulk API 2.0 | 대량 insert/update/upsert |
| 안전성 | `prepare`(치환만)와 `load`(적재) 분리 | 적재 전 결과 확인 가능 |
| 설정 | job JSON(매핑·객체·operation) | 재사용·버전관리 |

## 명령어

```
sfload init    -o <SObject> --org <alias> [-i <sample.csv>]   # describe → 매핑 job.json 뼈대 생성(헤더 자동 제안)
sfload prepare -c <job.json> -i <data.csv>                    # 헤더 매핑 + lookup Id 치환 → resolved.csv + errors.csv (적재 안 함)
sfload load    -c <job.json> -i <data.resolved.csv>           # Bulk insert/update/upsert + results.csv + 건수 대조
sfload run     -c <job.json> -i <data.csv>                    # prepare + load 한 번에 (errors 있으면 중단 옵션)
```

- `prepare`만 써서 깨끗한 CSV를 뽑아 기존 Data Loader로 적재하는 사용법도 1급 지원.

## 설정 파일 (`job.json`)

```jsonc
{
  "object": "Contact",
  "targetOrg": "dev",                 // sf alias
  "operation": "upsert",              // "insert" | "update" | "upsert"
  "externalIdField": "External_Id__c",// upsert 시 필수, 그 외 무시
  "mappings": {
    "이름":   "LastName",             // 소스헤더: 타겟API필드 (단순 매핑)
    "이메일": "Email",
    "거래처키": {                      // lookup 필드 매핑
      "field": "AccountId",
      "lookup": { "object": "Account", "key": "External_Id__c" }
    }
  },
  "onLookupMiss": "error"             // "error"(행 제외+리포트) | "blank"(공란 두고 진행)
}
```

규칙:
- 매핑 값이 문자열이면 단순 헤더 변환. 객체면 lookup 해소.
- `operation`별 필수: `update`는 `Id` 컬럼 매핑 필요, `upsert`는 `externalIdField` 필요.
- 매핑에 없는 소스 컬럼은 출력에서 제외.

## lookup Id 해소 (핵심)

1. 입력을 스트리밍하며 각 lookup 매핑의 **고유 key 집합** 수집.
2. key를 청크(기본 500개)로 나눠 `SELECT Id, <key> FROM <object> WHERE <key> IN (:chunk)` 조회 → `key→Id` 맵 구성.
3. 출력 시 lookup 컬럼을 Id로 치환.
4. 예외 처리:
   - **미매칭 key**: `onLookupMiss`에 따라 행 제외(`error`) 또는 공란(`blank`) — 어느 쪽이든 `errors.csv`에 행번호·필드·key 기록.
   - **중복 key**(하나의 key가 복수 Id): 모호로 간주, 해당 행 에러 리포트.
   - SOQL 인젝션 방지: key는 바인딩/이스케이프 처리.

## 산출물 / 리포트

- `prepare` → `<input>.resolved.csv`(타겟 API 헤더 + 치환된 Id), `<input>.errors.csv`(행번호·사유·원본값).
- `load` → `<input>.results.csv`(행별 success/Id/error), 콘솔에 `소스 N건 / 성공 S / 실패 F` 대조.
- 모든 단계 콘솔 요약 + 0이 아닌 종료코드로 실패 신호.

## 대용량 처리

- CSV 입력은 `csv-parse` 스트림으로 행 배치 처리(전체 메모리 적재 안 함).
- lookup 조회는 key 수집 후 일괄 → 행 처리 시 메모리 맵 참조.
- 출력도 스트림 기록. → 수십만 행도 렉 없이 처리.

## 모듈 구조

| 파일 | 책임 |
|------|------|
| `src/cli.ts` | 인자 파싱·명령 디스패치 (commander) |
| `src/auth.ts` | `sf org display --json` → jsforce `Connection` |
| `src/config.ts` | job.json 로드·검증(operation별 필수 검사) |
| `src/mapping.ts` | 한 행에 헤더 매핑 적용(순수 함수) |
| `src/lookup.ts` | key 수집·청크 SOQL 조회·key→Id 맵·치환(순수 + 조회 분리) |
| `src/prepare.ts` | 스트리밍 파이프라인: 매핑+치환 → resolved/errors |
| `src/load.ts` | Bulk API insert/update/upsert + results |
| `src/describe.ts` | 객체 필드 describe → init 매핑 뼈대 |
| `src/report.ts` | 콘솔 요약·CSV 리포트 작성 |

각 모듈 단일 책임, jsforce 의존부(auth/lookup 조회/load)와 순수 변환부(mapping/치환/config) 분리해 테스트 용이.

## 에러 처리

- 설정 오류(필수 필드 누락 등) → 즉시 명확한 메시지 + 비정상 종료.
- org 인증 실패(`sf` 미로그인/alias 오류) → 안내 메시지.
- lookup 미매칭/중복 → 리포트로 분리, 전체 중단하지 않음(설정에 따라).
- Bulk 부분 실패 → 성공분 유지 + 실패분 results.csv, 콘솔 경고.

## 테스트 (vitest)

- `mapping`: 단순/lookup 매핑 헤더 변환, 미매핑 컬럼 제외.
- `lookup`: 주입된 key→Id 맵으로 치환, 미매칭/중복 분기, 청크 분할 경계.
- `config`: operation별 필수 검증(update→Id, upsert→externalIdField), 잘못된 설정 거부.
- `report`: errors/results CSV 형식.
- jsforce는 mock(query/bulk 결과 주입). 대용량은 소규모 스트림 픽스처로 파이프라인 검증.
- 수동: 실제 sandbox alias로 `init`→`prepare`→`load` 소량 데이터 검증.

## 리스크

- **lookup key 품질**: 소스 key에 공백·중복·대소문자 차이 → 매칭률 저하. 트림/정규화 옵션은 차후. 현재는 있는 그대로 매칭 + 리포트로 가시화.
- **Bulk API 제약**: 일일 배치/레코드 한도. 대량 시 분할은 jsforce bulk가 처리하나 한도 초과는 org 설정 의존.
- **sf CLI 의존**: 미설치/미로그인 시 동작 불가 — 인증 단계에서 명확히 안내.
