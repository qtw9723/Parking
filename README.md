# Parking

공공데이터포털(data.go.kr)의 실시간 주차장 정보를 조회하는 API와, 개인 앱들이 함께 쓰는 Supabase 백엔드 모음입니다.
하나의 Supabase 프로젝트 안에 Edge Function이 서비스별로 나뉘어 있고, 같은 PostgreSQL을 공유합니다.

## 주차장 API

### 동작 방식

- **정적 정보**(이름, 주소, 좌표)는 `parking_lot` 테이블에 저장해 두고,
- **실시간 점유 현황**은 조회할 때마다 공공데이터 API에서 가져와 응답에 합칩니다.

### 두 공공 API의 ID 체계가 다릅니다

실시간 API(`PrkRealtimeInfo`)와 상세 API(`PrkSttusInfo`)의 `prk_center_id`는 서로 다른 체계라서,
두 API 모두에 존재하는 주차장은 5만 건 대 2만 건 중 351건뿐입니다.
그래서 ID가 겹치는 것만 골라 적재하는 `/reload`를 권장합니다.
(예전 방식인 `/init` + `/initInfo`는 배열 순서로 매칭해서 이름·주소가 다른 주차장에 붙을 수 있습니다.)

공공 API 원본에는 좌표가 비어 있는 데이터도 섞여 있습니다.

### 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/reload?min={면수}&limit={건수}` | **(권장)** 두 API의 교집합 중 총 주차면수가 `min` 이상인 것으로 전량 교체 적재 |
| `POST` | `/init` | (레거시) 주차장 ID 초기 적재 |
| `POST` | `/initInfo` | (레거시) 이름·주소·좌표 적재 |
| `GET` | `/parking` | 전체 주차장 + 실시간 점유 현황 |
| `GET` | `/parking?id={id}` | 단일 주차장 + 실시간 점유 현황 |

`/reload`는 기존 데이터를 모두 지우고 교체하며, 상세 API 조회 때문에 약 30초가 걸립니다.
`min`의 기본값은 50이고, `limit`을 생략하면 조건을 만족하는 전량을 적재합니다.
적재·교체용 엔드포인트는 Supabase의 JWT 검증에 의존합니다.

## 함께 들어 있는 서비스

| 함수 | 설명 |
|------|------|
| `notepad` | 메모장 앱의 노트 CRUD와 버전 기록 |
| `todos` | Todo 일정 CRUD |
| `mailer` | 예약 메일 발송 |

이 외에 개인 도구용 함수들이 같은 프로젝트에 있습니다.

## 기술 스택

- Supabase Edge Functions (Deno 2)
- PostgreSQL 17
- 외부 API: 공공데이터포털 주차정보 (`B553881/Parking`)

## 구조

```
supabase/
├── config.toml
├── functions/
│   ├── parking/      라우터(index.ts), 데이터 레이어(data.ts)
│   ├── notepad/
│   ├── todos/
│   ├── mailer/
│   └── ...
└── migrations/       테이블 스키마 (SQL)
```

`src/Main.java`는 IDE가 만든 빈 파일이고, 실제 백엔드는 `supabase/functions/`에 있습니다.

## 시작하기

[Supabase CLI](https://supabase.com/docs/guides/cli)가 필요합니다.

```bash
touch .env                      # 아래 환경 변수를 채웁니다
supabase start                  # 로컬 환경 시작
supabase functions serve parking
```

### 환경 변수

| 변수 | 용도 |
|------|------|
| `SUPABASE_URL` | Supabase 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | DB 접근용 서비스 롤 키 (서버 전용, 커밋 금지) |
| `PUBLIC_DATA_SERVICE_KEY` | 공공데이터포털 API 인증키 |

### 배포

```bash
supabase db push                  # 마이그레이션 반영
supabase functions deploy parking # 함수 배포
```
