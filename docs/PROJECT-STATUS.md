# 프로젝트 현황 & 이어가기 (Handoff / Decision Log)

> 이 문서는 **다음 작업자(또는 컨텍스트가 초기화된 다음 세션)** 가 끊김 없이 이어가도록 현황·결정·리뷰 처리 내역을 남긴 것입니다. 최종 업데이트: 2026-06-17.

---

## 1. 현재 상태 한눈에

- **무엇**: `sf-lookup-loader`(CLI 명령 `sfload`) — 엑셀/CSV → Salesforce insert/update/upsert. 핵심은 **lookup 필드의 업무 key → 실제 레코드 Id 자동 치환**.
- **버전/품질**: v0.1.0, **vitest 72개 통과**, `tsc --noEmit` 클린, **런타임(prod) 의존성 취약점 0건**, `main` 최신.
- **명령**: `init`(대화형 마법사) · `check`(사전점검) · `prepare`(매핑+치환) · `load`(Bulk 적재) · `run`(prepare+load).
- **저장소**: https://github.com/yonzn0213/sf-lookup-loader (public, MIT).
- **인증**: 로컬 `sf` CLI 세션 재사용(토큰 비저장).

### 이어가는 법 (다음 세션)
```bash
cd C:/Users/pc/Downloads/sf-migrate   # 로컬 경로
npm install && npm test               # 72 통과 확인
npm run build                         # dist 생성
node dist/cli.js --help               # 명령 확인
```
설계/계획 문서는 `docs/superpowers/specs`·`docs/superpowers/plans`에 시간순으로 있음.

---

## 2. 완료된 것 (기능 + 신뢰성)

- lookup key→Id 자동 치환(앞뒤 공백·대소문자 무시, 중복/미매칭 리포트), `prepare`/`load` 2단계 분리.
- **대화형 `init` 마법사**(org 메타데이터 목록 선택, referenceTo 자동/다형성 선택, 저장 후 자동 dry-run, 읽기전용).
- **`check`**: 비대화형 사전점검(필드/관계/key 존재, referenceTo 일치, operation 필수, FLS·권한 경고, 중복매핑·필수필드 누락). CI 프리플라이트.
- **스트리밍**: `prepare` 2-pass 스트리밍 + `load` 입력 CSV 스트림 투입(대용량 메모리 안정).
- **부분 실패 복구**: 실패 행을 재적재 가능한 `*.failed.csv`로 저장 + 멱등성(upsert) 안내.
- **audit log**: `load` 실행마다 `sfload-audit.log`(JSONL) 기록(best-effort — 기록 실패가 적재 결과를 뒤집지 않음).
- **보안**: 별칭 셸 인젝션 차단, SOQL 이스케이프, form-data 취약점 패치.
- 실제 sandbox(YG1 Partial) 종단 테스트 통과(부모/자식 Account, lookup→ParentId, 생성분만 삭제).

---

## 3. 24개 페르소나 평가 요약 (2026-06-17)

- 평균 **3.13/5**, wouldUse **yes 8 / maybe 13 / no 3** (yes 8명 중 7명이 기술 직군).
- 판정: **"개발자 주도 중소규모엔 지금 유용, 엔터프라이즈/대용량/비개발/규제엔 미성숙(v0.1)."**
- dealbreaker 6개 중 **5개 해소**(load 스트리밍·부분실패 복구·audit log·취약점·에러 진단). **남은 1개 = GUI(비개발 세그먼트)**.

---

## 4. 코드리뷰 처리 내역 (지적 → 처리 → 검증)

서브에이전트 코드리뷰를 2라운드 받았고, 각 지적을 다음과 같이 처리했다.

### 라운드 A — 대화형 `init` 리뷰
| 등급 | 지적 | 처리 |
|------|------|------|
| Critical | update가 Id를 매핑할 수 없어 항상 실패(Id는 createable/updateable 아님) | update 시 필드 선택지에 **Id 포함** + 테스트 추가 |
| Critical | 다형성 lookup이 `referenceTo[0]`을 무단 선택 | `referenceTo.length>1`이면 **대상 객체 선택** 프롬프트 |
| Important | key 후보에 비교 불가 타입까지 노출 | **비교 가능 타입 + 고유키**로 후보 제한, 고유키 우선 정렬 |
| Important | 위험(비고유) key 선택 시 컬럼 통째 skip | **재선택 유도** 루프로 변경 |
| Minor | update/upsert 빈 셀이 기존 값 null 덮어씀 | **skipEmptyFields 질의** 추가 |

### 라운드 B — `audit`/`check` 리뷰
| 등급 | 지적 | 처리 |
|------|------|------|
| **Critical** | 감사 로그 append 실패가 **적재 성공을 "실패"로 둔갑** → 재실행 중복 위험 | `appendAudit`를 **try/catch(best-effort)** 로 감쌈(경고만) |
| Important | `check`가 같은 필드에 두 컬럼 매핑(덮어쓰기)을 못 잡음 | check에 **중복 매핑 warn** 추가 |
| Important(M3) | insert 시스템 필수 필드 누락 정적 검출 안 함 | check가 `requiredFieldsMissing` 재사용해 **필수필드 warn** |
| Important | update의 Id가 lookup 매핑이면 미매칭 행 누락(데이터 의존) | check에 **안내 warn** 추가 |
| Important | 다중 lookup 테스트가 교차오염을 증명 못 함 | 두 객체 **같은 key 값·다른 Id** 케이스로 테스트 강화 |
| Minor(M4) | check의 describe 실패가 스택트레이스 노출 | **친절한 에러 메시지 + 종료코드** 처리 |
| 확인 | check가 org에 쓰기 안 함 / 토큰 미기록 | 의도대로 동작 확인(수정 없음) |

### 라운드 C — 정밀 검증(15차원·다수 에이전트, 2026-06-17)
코드 전반을 15개 차원으로 검증→적대적 확인→종합. **총 104건 발견, 적대적 검증 통과 high 15건.** 즉시 수정(mustFix 8) + 고도화(enhance) 처리:
| 처리 | 내용 |
|------|------|
| CLI 최상위 에러 경계 | `parseAsync().catch`로 스택트레이스 대신 메시지·종료코드 |
| config 입력 검증 | 매핑 값이 배열/숫자/불완전 객체면 차단(`mappings['x'] 형식 오류`) |
| loadJob 친절 에러 | 파일없음/JSON오류/스키마 실패를 경로 포함 메시지로 |
| SOQL IN 문자수 청킹 | `chunkByBudget`(개수+~3800자) — 긴 key 500개 SOQL 초과 방지 |
| init 중복헤더 | 마법사 진입 전 `assertUniqueHeaders` |
| getConnection 진단 | ENOENT(미설치)/별칭/네트워크 구분 + 다음행동 안내 |
| load unprocessed 가드 | `Array.isArray` — string일 때 문자수 오집계 방지 |
| `auditRequired` 옵션 | 규제 환경: 감사 기록 실패를 적재 실패로 신호 |
| check 강화 | key 타입(비교가능) 검증, 중복매핑·필수필드 경고 |
| prepare 소스헤더 검증 | 매핑 소스 컬럼이 CSV에 없으면 조기 에러(헤더 오타 무음 미매칭 방지) |
| wizard onLookupMiss | error/blank 선택 프롬프트 추가 |
| load 통합 테스트 | bulk2 mock으로 성공/실패/unprocessed 경로 검증(72 tests) |

> medium/큰 작업은 README의 **TODO/추후 과제**·**알려진 한계**로 이관(거버너 한도 자동분할, 필드 타입 정규화, org 특수구조 감지, 진행률/취소, GUI 등).

> 세 리뷰/검증 모두 **"changes-requested"** 였고, Critical/high는 전부 수정 후 테스트로 검증함.

---

## 5. 남은 결정: GUI 방향 (핵심 미결 사항)

페르소나 평가의 마지막 dealbreaker는 GUI 부재(비개발 어드민·BA·dataloader.io/Gearset 사용자). 어떻게 갈지는 **"최종 목표를 무엇으로 두느냐"** 에 달려 있다.

### 먼저 정해야 할 것: 최종 목표
- **(가) 개발자 생산성 도구** — 파트너/SI 개발자·어드민(터미널 가능)이 마이그레이션을 빠르고 안전하게. → 현재 포지션.
- **(나) 범용 도구** — 비개발 어드민·BA까지 포함하는 시장 확대.

### 세 가지 방법과 의미·적합성
| 방법 | 의미 | 비용/리스크 | 어떤 목표에 맞나 |
|------|------|------------|------------------|
| **1. GUI 안 함 (CLI 유지)** | 개발자/파워유저에 집중, 신뢰성·기능 깊이로 승부 | 낮음 | **(가)에 최적**. ROI 높음, 평가 권고. 비개발 세그먼트는 포기 |
| **2. 별도 GUI 제품** | 비개발자까지 확대. **데스크톱**(Tauri/Electron, 로컬 sf 재사용 → 배포 쉽고 보안모델 유지) vs **웹**(사용자별 OAuth + 호스팅 + 멀티유저 → 책임·비용 큼) | 큼 | **(나)에 필수**. 별도 spec→plan 필요. 데스크톱이 웹보다 현실적 |
| **3. 경량 절충** | 실행은 여전히 CLI지만 **결과 이해**를 도움 — 예: prepare/load 결과를 보기 좋은 **HTML 리포트**로 출력, `init` 더 친절히 | 중간 | (가)+α. 적은 비용으로 비개발자 **협업** 개선(개발자가 돌리고 결과를 비개발자가 검토) |

### 추천
1. **최종 목표를 먼저 확정**한다.
2. (가)라면 → **방법 1 + 방법 3의 HTML 리포트**만 더해 CLI 완성도를 높인다(가장 ROI 높음, 평가와도 일치).
3. (나)라면 → **방법 2를 데스크톱(로컬 sf 재사용)** 으로 별도 brainstorm→plan. **웹은 가장 마지막**(OAuth·호스팅·데이터 보안 책임이 가장 큼).

> 결론: 현재 데이터/평가는 **(가) + HTML 리포트**를 가리킨다. 범용(나)로 키울 전략적 이유가 있을 때만 데스크톱 GUI에 투자.

---

## 6. 그 외 남은 항목 (우선순위 낮음)

- (성능, 선택) `prepare` 단일 패스(윈도우) 최적화 / `load` **결과** 스트리밍 — 입력 메모리 목표는 이미 달성. 결과 배열 버퍼링이 문제될 **초대용량에서만** 고려.
- 다객체 **체인** lookup(lookup의 key를 또 다른 lookup으로) — 수요 시(YAGNI).
- **대화형 `init` 실제 org 수동 1회 확인** — 프롬프트라 자동화 불가, init은 읽기전용이라 안전. 사용자가 한 번 돌려보면 됨.

---

## 7. 작업 규칙 메모

- 커밋: Conventional Commits, 한국어 제목 한 줄, **AI 공동저자 트레일러 금지**.
- 변경은 TDD(순수 로직 단위테스트) + 완료 시 서브에이전트 코드리뷰로 검증.
- 타입 게이트 `npx tsc --noEmit`(src 대상). 테스트는 `npm test`(vitest).
