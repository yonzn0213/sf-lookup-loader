# 대화형 `init` 마법사 설계 (신뢰성 우선)

- 날짜: 2026-06-15
- 상태: 승인됨 (구현 plan 대기)

## 배경

`job.json`을 손으로 작성하는 것은 비개발자에게 진입장벽이고, 오타·잘못된 필드 선택은 **마이그레이션 사고**로 이어진다. 마이그레이션은 되돌리기 어려운 중요 작업이므로, `init`을 **org 메타데이터 기반 대화형 마법사**로 만들어 실수·버그를 최대한 차단한다.

## 목표 / 비목표

**목표**
- 대화형으로 객체·필드·lookup 매핑·operation을 **목록에서 선택**해 `job.json` 생성 (타이핑 오타 제거)
- 모든 선택을 **org describe로 검증** (존재하지 않는 객체/필드 선택 불가)
- lookup은 필드의 `referenceTo`로 **대상 객체 자동 확정** (엉뚱한 객체 지정 불가)
- 저장 전 **요약 확인**, insert 필수필드 미매핑·중복키 위험 **경고**
- 저장 직후 **자동 dry-run**(`prepare`)으로 적재 전 매핑 정확성 즉시 검증
- `init`은 **쓰기 없음** (describe + 읽기전용 prepare만)

**비목표 (YAGNI)**
- GUI/웹
- 매핑 변환(값 가공) 규칙 — 현 매핑 모델 유지
- 다국어 — 한국어 프롬프트

## 핵심 결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 프롬프트 | `@inquirer/prompts` | 검색형 select/checkbox/confirm → 오타 제거, 유지보수 활발 |
| 선택지 출처 | org describe(객체·필드) | 실재하는 값만 노출 → 검증을 UX에 내장 |
| lookup 대상 | 필드 `referenceTo`에서 자동 | 사용자가 대상 객체를 잘못 고를 여지 제거 |
| 검증 시점 | 선택 시점(목록 제한) + 저장 전 요약 + 저장 후 dry-run | 다층 방어 |
| 안전성 | init은 읽기전용(describe/prepare) | 마법사 자체가 데이터를 바꾸지 않음 |

## 마법사 흐름

1. **대상 객체 선택** — `listObjects()`(describeGlobal)에서 검색·선택.
2. **operation 선택** — insert/update/upsert.
   - upsert → 객체의 **External Id 필드** 목록에서 `externalIdField` 선택(없으면 안내 후 중단).
   - update → 다음 단계에서 `Id` 매핑이 없으면 경고.
3. **샘플 CSV 헤더 로드** — `-i <csv>` 필수. 헤더 추출(중복 헤더면 에러).
4. **헤더별 매핑** — 각 헤더마다 select: `필드 매핑 / lookup 매핑 / 건너뛰기`
   - 필드: 객체의 **입력 가능 필드**(createable 또는 updateable) 목록에서 선택(라벨+API명).
   - lookup: 객체의 **reference 타입 필드**만 추려 선택 → 필드의 `referenceTo[0]`로 대상 객체 확정 → 대상 객체의 필드에서 **key 필드** 선택. key가 unique/externalId/idLookup이 아니면 중복 위험 경고.
5. **검증·경고**
   - operation=insert: `createable && !nillable && !defaultedOnCreate` 인데 미매핑인 **필수 필드** 목록 경고 후 진행 확인.
   - operation=update: `Id` 매핑 없으면 경고(진행 차단 또는 재선택).
6. **요약 확인** — `CSV헤더 → 필드 / lookup(대상.key)` 표 출력, `confirm`으로 확정.
7. **job.json 저장** (기존 형식 그대로).
8. **자동 dry-run** — 저장 직후 `prepare(conn, job, sampleCsv)` 실행 → `변환 N / 미매칭 K`와 `errors.csv` 위치 출력. (읽기전용)

## 모듈 구조

| 파일 | 책임 | 비고 |
|------|------|------|
| `src/describe.ts` | 확장: `FieldInfo`에 type·referenceTo·createable·updateable·nillable·defaultedOnCreate·externalId·idLookup 추가, `listObjects(conn)` 추가 | IO(jsforce) |
| `src/init-logic.ts` | **순수 로직**: `requiredFieldsMissing(fields, mappedApiNames)`, `summaryRows(job)`, `keyFieldRisk(field)`(중복위험 판정), `buildJob(answers)` | 단위테스트 집중 |
| `src/wizard.ts` | inquirer 흐름 오케스트레이션. describe 호출 + 프롬프트 + init-logic 조합 → Job 반환 | 얇은 I/O |
| `src/cli.ts` | `init`이 wizard 호출 → job.json 저장 → dry-run(prepare) | 기존 |

- `wizard.ts`의 프롬프트는 `@inquirer/prompts` 함수를 **모듈 경유 호출**하되, 핵심 판단·구성은 전부 `init-logic.ts`(순수)로 빼서 테스트한다.

## 타입 (describe 확장)

```ts
export interface FieldInfo {
  name: string;
  label: string;
  type: string;              // "reference", "string", "picklist" ...
  referenceTo: string[];     // reference일 때 대상 객체들
  createable: boolean;
  updateable: boolean;
  nillable: boolean;
  defaultedOnCreate: boolean;
  externalId: boolean;
  idLookup: boolean;
}
```

## 에러 처리 / 안전

- describe/connection 실패 → 명확한 메시지 후 중단(쓰기 없음).
- upsert인데 External Id 필드가 없는 객체 → 안내 후 중단.
- 사용자가 도중 취소(Ctrl-C) → 부분 파일 저장하지 않음.
- 저장 전 항상 요약 + confirm. dry-run은 실패해도 job.json은 이미 저장됨(사용자가 수동 prepare 가능)을 안내.

## 테스트 (vitest)

- `init-logic`: `requiredFieldsMissing`(필수 필드 누락 판정), `summaryRows`(요약 표 데이터), `keyFieldRisk`(unique/externalId면 위험없음, 아니면 경고), `buildJob`(답변 → 올바른 Job, lookup은 referenceTo 기반 대상 채움).
- `describe`: 확장된 `FieldInfo` 매핑(주어진 describe 응답 → 필드 메타), reference 필드 필터.
- 프롬프트 흐름: `@inquirer/prompts`를 mock해 대표 시나리오(단순+lookup 매핑) 1~2개 스모크.
- 기존 42개 테스트 회귀 유지. 구현은 TDD + 서브에이전트 2단계 리뷰(스펙 준수→품질).

## 리스크

- **대화형 테스트의 한계**: 프롬프트 I/O는 단위 테스트가 어렵다 → 판단 로직을 순수 함수로 최대한 분리해 테스트 커버, I/O 레이어는 얇게.
- **describeGlobal 객체 수**: org에 객체가 많아도 검색형 select로 처리. 느리면 1회 캐싱.
- **신규 의존성**(`@inquirer/prompts`): dev/런타임 의존성 증가 — CLI 도구라 수용. prod audit는 계속 확인.
