# CLAUDE.md

이 파일은 Claude Code(claude.ai/code)가 이 저장소에서 작업할 때 참고하는 가이드입니다.

## 프로젝트 개요

하나의 Supabase 프로젝트에서 두 개의 독립적인 서비스를 운영합니다:
- **parking** — 한국 공공데이터포털(data.go.kr) 실시간 주차장 데이터 API (운영 중)
- **notepad** — 메모장 앱 백엔드 API (`/Users/sangjun/IdeaProjects/notepad` 프론트와 연동)

## 개발 명령어

```bash
supabase start                      # 로컬 개발 환경 시작
supabase stop                       # 로컬 개발 환경 중지
supabase functions serve parking    # parking Edge Function 로컬 실행
supabase functions serve notepad    # notepad Edge Function 로컬 실행
supabase functions deploy parking   # parking 배포
supabase functions deploy notepad   # notepad 배포
supabase db push                    # 스키마/마이그레이션 DB 반영
supabase status                     # 로컬 서비스 URL 및 포트 확인
```

로컬 서비스 주소 (실행 중일 때):
- API: `http://localhost:54321`
- DB: `localhost:54322`
- Studio: `http://localhost:54323`

## 아키텍처

**기술 스택:** Deno 2 Edge Function (Supabase) + PostgreSQL 17

각 서비스는 `supabase/functions/{서비스명}/` 디렉토리에 독립적으로 위치하며, 같은 DB를 공유합니다.

---

## parking 서비스

### 이중 데이터 모델

1. **정적 데이터** — `parking_lot` 테이블에 저장 (이름, 주소, 좌표, `prk_center_id` PK)
2. **실시간 데이터** — 조회 시 `data.go.kr`에서 즉시 fetch 후 응답에 병합

### 데이터 초기화 흐름

API를 사용하기 전에 DB를 먼저 초기화해야 합니다:
1. `POST /init` — `PrkRealtimeInfo` 엔드포인트에서 주차장 ID를 가져와 `parking_lot`에 upsert
2. `POST /initInfo` — `PrkSttusInfo` 엔드포인트에서 상세 정보(이름/주소/좌표)를 가져와 업데이트

### Edge Function 구조

- `supabase/functions/parking/index.ts` — HTTP 라우터, 핸들러 분기
- `supabase/functions/parking/data.ts` — 데이터 레이어: Supabase DB 쿼리 + 외부 API 호출

### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/init` | 주차장 ID 초기 적재 |
| POST | `/initInfo` | 주차장 상세 정보 적재 |
| GET | `/parking` | 전체 주차장 목록 + 실시간 점유 현황 |
| GET | `/parking?id={id}` | 단일 주차장 + 실시간 점유 현황 |

---

## notepad 서비스

프론트엔드: `/Users/sangjun/IdeaProjects/notepad` (React + Vite)

### Edge Function 구조

- `supabase/functions/notepad/index.ts` — HTTP 라우터, CORS 처리 (브라우저 직접 호출)
- `supabase/functions/notepad/data.ts` — `notes` 테이블 CRUD

### API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/notepad` | 전체 노트 목록 (content 제외) |
| GET | `/notepad?id={id}` | 단일 노트 전체 조회 |
| POST | `/notepad` | 노트 생성 |
| PATCH | `/notepad?id={id}` | 노트 수정 |
| DELETE | `/notepad?id={id}` | 노트 삭제 |

### DB 스키마

`notes` 테이블 스키마는 `/Users/sangjun/IdeaProjects/notepad/supabase-schema.sql` 참고. 이 SQL을 parking Supabase 프로젝트 DB에 실행해야 합니다.

### 프론트엔드 연동 시 주의사항

현재 notepad 프론트는 Supabase SDK로 DB에 직접 연결합니다. Edge Function으로 전환 시 `useNotes.js`의 Supabase SDK 호출을 `fetch('/functions/v1/notepad', ...)` 방식으로 교체해야 합니다.

## 환경 변수

`.env` 파일에 설정 (커밋 제외):
- `SUPABASE_URL` — Supabase 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY` — DB 접근용 서비스 롤 JWT
- `PUBLIC_DATA_SERVICE_KEY` — data.go.kr API 인증키

Edge Function 내에서는 `Deno.env.get('변수명')`으로 접근합니다.

## 참고 사항

- `src/Main.java`는 플레이스홀더이며, 실제 백엔드는 `supabase/functions/`에 있습니다.
- 외부 API 기본 URL: `http://apis.data.go.kr/B553881/Parking/`
- Edge Runtime 정책은 `per_worker`로 설정되어 로컬 개발 시 핫 리로드가 활성화됩니다.
