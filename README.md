# sfload — Salesforce 데이터 마이그레이션 CLI

엑셀/CSV 데이터를 Salesforce에 삽입(insert/update/upsert)할 때 헤더 매핑·lookup Id 자동 치환·검증을 처리하는 로컬 CLI.

## 설치
```bash
npm install && npm run build
```

## 인증
Salesforce CLI(`sf`)에 로그인된 org 별칭을 그대로 사용합니다(자격증명 저장 안 함).
```bash
sf org login web --alias dev
```

## 사용
```bash
sfload init -o Contact --org dev -i data.csv      # 매핑 설정(job.json) 뼈대 생성
sfload prepare -c job.json -i data.csv            # 헤더 매핑 + lookup Id 치환 (적재 안 함)
sfload load -c job.json -i data.resolved.csv      # Bulk 적재 + 결과 리포트
sfload run -c job.json -i data.csv                # prepare + load 한 번에
```

## License
MIT
