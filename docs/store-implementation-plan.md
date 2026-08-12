# 퍼스트파티 스토어 구현 계획

> 2026-08-11. C2C 마켓을 2단계로 미루고 RelayOS 가 직접 올리는 스토어를 먼저 연다는
> 피벗의 구현 계획서다. 전략과 정책은 [marketplace-plan.md](marketplace-plan.md),
> 구조 비교는 다이어그램 아티팩트 참조. 이 문서는 파일 단위 작업 목록과 계약이다.

## 0. 범위

**이번에 구현 (0.5단계, 무료 스토어)**

- 정본 저장소: index.json + `.relay` 아티팩트를 담는 원격 정본 + CI 판정
- 러너: 원격 인덱스 읽기, 아티팩트 다운로드와 캐시, ref 로 설치
- 콘솔 마켓: 로컬 선반과 스토어 병합 표시
- 정적 웹 카탈로그: 같은 index 를 읽는 공개 사이트

**설계만 하고 구현은 다음 착수 (1단계, 유료)**

- 라이선스 키 장부, redeem 함수, 비공개 버킷, 결제사 연동

**하지 않음 (2단계로 미룸)**

- 계정, 판매자 자격, 리스팅 심사, 정산, 관리자 웹 콘솔, 신고 큐

전제: 0단계(봉투, 봉인, prepare/activate, 고지서, 로컬 선반)는 구현·검증 완료 상태다.

---

## 1. C2C 호환 규율 — 코드가 지켜야 할 계약

나중에 일반 판매자를 붙이는 작업이 "덧셈"이 되도록, 0.5단계 구현이 지키는 여섯 가지.

| # | 규율 | 이번 구현에서 |
| --- | --- | --- |
| 1 | 클라이언트는 계약만 안다 | 인덱스에 `version: 1` 필수. 데몬은 모르는 major 를 명시 에러로 거부. URL 은 설정값, 하드코딩 금지 |
| 2 | 키 = 서버 장부의 불투명 토큰 | 1단계 설계(6장)에 반영. 오프라인 서명 라이선스 금지 |
| 3 | 유료 아티팩트는 첫날부터 비공개 버킷 | 1단계 설계에 반영. 공개 CDN + URL 은닉 금지 |
| 4 | 엔트리에 seller 필드를 지금부터 | `MarketEntry.seller` 추가. 값은 당분간 전부 `@relay` 또는 `@yuni` |
| 5 | scope 규율 | 퍼스트파티도 `@relay/*`, `@yuni/*` 로만 발행. 일반명사 scope 선점 금지 |
| 6 | 가격은 패키지 밖 | 이미 결정됨. 가격·스크린샷·긴 소개는 index(리스팅) 소유, 매니페스트에 넣지 않는다 |

---

## 2. 계약: 스토어 인덱스 v1

정본과 모든 소비자(데몬, 웹 카탈로그)가 공유하는 유일한 계약.

```ts
interface StoreIndexV1 {
  version: 1;                 // major 불일치 = 거부 (규율 1)
  updatedAt: string;          // ISO 8601
  entries: StoreEntry[];
}

interface StoreEntry {
  ref: string;                // "@yuni/todo" — 신원의 정본
  seller: string;             // "@yuni" (규율 4)
  version: string;
  url: string;                // 아티팩트 절대 URL (https)
  size: number;
  digest: string;             // "sha256:..." — 다운로드 검증의 기준
  display_name: string;
  description: string;
  icon: string | null;        // 절대 URL
  files: number;
  disclosure: Disclosure;     // 러너의 disclosure() 산출물 그대로
  packedAt: string;
}
```

- 로컬 선반 index 는 `file`(파일명), 원격은 `url`(절대 URL). 데몬이 내부 표준형으로
  정규화하고 화면은 `source: "local" | "<index URL>"` 로 출처를 안다
- 유료가 생기면 엔트리에 `price` 가 붙고 `url` 이 redeem 엔드포인트로 바뀐다.
  스키마 minor 확장이라 version 은 1 유지

---

## 3. 컴포넌트별 작업

### 3.1 정본 저장소 (신규 저장소)

```
relay-store/                 (깃허브 저장소, Pages 또는 raw 로 서빙)
  index.json
  artifacts/  *.relay
  icons/      *-icon.svg
  scripts/    validate.ts     CI 판정
  .github/workflows/validate.yml
```

- **CI 판정 (자동 심사 관문의 씨앗)**: push 마다
  1. index.json 스키마 판정 (version, 필수 필드, ref 형식 `@scope/name`)
  2. 엔트리마다 아티팩트 실재 + `sha256 재계산 == digest`
  3. 아티팩트 해체 검사: 러너의 `unpackArtifact` 재사용 — 링크·경로탈출 거부 확인,
     `relay.yaml` 판정 통과, `declaredPaths` 밖 파일 없음
  4. 실패 시 merge 차단
- **발행 절차 (수동으로 시작)**: 로컬에서 `relay pack <이름>` → 아티팩트·아이콘 복사 →
  index.json 갱신 → PR → CI 통과 → merge. 자동화 헬퍼(`relay publish --store`)는
  이 절차가 굳은 뒤에
- 초기 등재물: todo, aside-pilot, video-studio, scribe, music-sommelier (전부 무료)

### 3.2 러너: 원격 인덱스

**신규 `runner/registry.ts`** (예상 150줄 안팎)

```ts
fetchStoreIndex(url): Promise<StoreEntry[]>
  // 4초 타임아웃, version !== 1 이면 명시 에러, 메모리 캐시 TTL 5분
downloadArtifact(entry): Promise<string>
  // ~/.relay/cache/artifacts/<digest-hex>.relay 로 저장
  // 받은 뒤 sha256 대조, 불일치 즉시 삭제 + 에러 (검증 전 바이트는 신뢰하지 않는다)
  // digest 키 캐시라 불변 — 캐시 히트면 재다운로드 없음
  // https 만 허용 (개발용 localhost 예외), 다운로드 상한 200MB
```

**수정 파일**

| 파일 | 변경 |
| --- | --- |
| `state.ts` | `STORE_INDEX_URL` (.env `RELAY_STORE_INDEX`, 기본값 공식 URL 상수), 캐시 디렉토리 |
| `api.ts` | `/market/index`: 로컬 선반 + 원격 병합, 엔트리에 `source` 부여. 원격 실패 시 로컬만 + `remote_error` 필드. `/install/prepare`: `{ref}` 입력 지원 — 원격 엔트리를 다운로드·검증 후 기존 `prepareArtifact(file, {digest, registry})` 로 위임 |
| `installer.ts` | 변경 없음 (prepare 가 이미 digest·registry 를 받는다) |
| `relay.ts` | `relay install @scope/name` — ref 판별 → registry 경유 다운로드 → 기존 동의 흐름. `relay store` (원격 카탈로그 목록 조회, 선택) |
| `pack.ts` | `MarketEntry` 에 `seller` 추가 (manifest name 의 scope 에서), 로컬 index 도 `version: 1` 로 |

`origin.registry` 에 인덱스 URL 이 기록된다 (필드는 0단계에 준비됨).

### 3.3 콘솔 마켓 화면 (소폭)

- 카드·상세에 seller 와 출처 표시 (로컬 선반 / 스토어)
- 원격 엔트리 설치: `prepareInstall({ref})` 호출로 변경 (다운로드 진행 상태 표시)
- 원격 실패 시 조용한 배너: "스토어에 닿지 않아 로컬 선반만 보입니다"
- `?ref=` 쿼리로 특정 패키지 상세 직행 (웹 카탈로그의 "콘솔에서 열기" 착지점)

### 3.4 정적 웹 카탈로그 (신규)

- 별도 저장소 권고 (배포 주기가 다름). Next 정적 export 또는 Astro — **빌드 시
  index.json 을 읽어 SSG**, 클라이언트에서 재검증 fetch
- 페이지: `/`(카탈로그), `/p/<scope>/<name>`(상세). 디자인은 목업 3판의 노션 문법을
  그대로 이식 (카드 = 썸네일·제목·판매자·가격, 상세 = 마케팅 제목 + 요구 블록)
- 상세의 행동 버튼: **"콘솔에서 열기"** → `http://127.0.0.1:4747/pkg/system/view/market/?ref=...`
  (데몬이 없으면 설치 안내 문구로 폴백). 결제 버튼 자리는 유료 단계에 활성화
- 배포: Vercel 정적 (기존 계정 재사용 가능)

### 3.5 문서

- `marketplace-plan.md`: 단계 재편(0.5 신설), C2C 호환 규율 절, 결정 현황 갱신 — 이 계획과 함께 반영
- README: `relay pack`/`relay install @ref` 사용법, 스토어 URL

---

## 4. 작업 순서와 규모

| 순서 | 작업 | 산출물 | 규모 | 의존 |
| --- | --- | --- | --- | --- |
| 1 | 인덱스 v1 계약 + pack 에 seller/version | pack.ts, 타입 | 소 | 없음 |
| 2 | registry.ts (fetch, download, 캐시, 검증) | 신규 파일 | 반나절 | 1 |
| 3 | api.ts 병합 + prepare ref 지원 + CLI | 수정 3파일 | 반나절 | 2 |
| 4 | 콘솔 화면 갱신 + 빌드 | market/page.tsx | 반나절 | 3 |
| 5 | relay-store 저장소 + CI 판정 + 초기 5종 등재 | 신규 저장소 | 반나절 | 1 |
| 6 | E2E (5장) | 기록 | 반나절 | 3, 5 |
| 7 | 웹 카탈로그 | 신규 저장소 + 배포 | 1~2일 | 5 |

1~6 이 코어 (2~3일), 7 은 병행 가능. 유료(6장)는 별도 착수.

---

## 5. 검증 계획 (E2E)

| # | 시나리오 | 통과 기준 |
| --- | --- | --- |
| 1 | 원격 인덱스 표시 | 콘솔 마켓에 스토어 엔트리가 출처 표시와 함께 뜬다 |
| 2 | ref 설치 | `relay install @local/music-sommelier` → 다운로드 → 봉인 검증 → 고지서 → 동의 → 설치, `origin.registry` 에 URL 기록 |
| 3 | 캐시 | 같은 버전 재설치 시 재다운로드 없음 |
| 4 | 위조 방어 | 아티팩트를 바꿔치기한 인덱스 → digest 불일치로 설치 거부, 캐시에 안 남음 |
| 5 | 오프라인 | 원격 실패 시 로컬 선반만 + 배너, 데몬은 정상 |
| 6 | 버전 정책 | `version: 2` 인덱스 → "지원하지 않는 인덱스 판" 명시 에러 |
| 7 | 웹 카탈로그 | 같은 index 로 빌드된 상세가 뜨고, 콘솔에서 열기가 로컬 마켓 상세로 착지 |
| 8 | 격리 홈 신선 설치 | RELAY_HOME 분리 + 공식 인덱스만으로 5종 설치 왕복 (이번엔 포트까지 분리해서) |

---

## 6. 유료 설계 (1단계 — 이번엔 구현하지 않음)

규율 2, 3 을 여기서 지킨다.

```
키 장부 (유일한 DB, 표 하나)
  key_hash      키의 해시 (평문 저장 금지)
  ref           "@relay/video-studio"
  issued_at / revoked_at
  email_hash    영수증 조회용 (선택)
  account_id    NULL — C2C 전환 때 "키를 계정에 귀속" 이 이 칸 채우기

redeem 함수 (서버리스 1개)
  POST /redeem { key, ref }  → 장부 대조 → 비공개 버킷 서명 URL (수 분 만료)
  POST /webhook (결제사)     → 키 발급 + 이메일 발송

클라이언트
  index 엔트리에 price 존재 → 콘솔이 "키 입력" 흐름 → vault 에 `store-key/<ref>` 저장
  → redeem → 서명 URL 다운로드 → 이후는 무료와 동일 (digest 검증부터)
```

**결제사 확정 (2026-08-11): Payple. 가맹 심사 완료.** relay-cli 의 연동 코드
(`web/src/lib/payple.ts`, `api/payments/{prepare,approve,callback}`)를 웹 카탈로그에
이식한다. callback 이 키 발급 함수(issue-key)를 부르는 구조 — 결제사는 키 발급의
자동 트리거일 뿐이므로, 키 코어(발급·장부·redeem·비공개 아티팩트)는 Payple 연동 전에
로컬에서 완성·검증한다. 결제 전 임시 운영도 가능: 입금 확인 후 관리자가 issue-key 수동 실행.

---

## 6.5 배포 계획 (relay-store 을 세상에 올리기)

> 2026-08-11 추가. 유료 코어가 생기면서 원래 0.5단계의 "GitHub Pages 정적" 계획이
> 그대로는 성립하지 않게 됐다 — 이 절이 그 갱신이다.

### 핵심 제약: 공개와 비공개가 한 저장소에 산다

| 것 | 공개 여부 |
| --- | --- |
| index.json, 무료 봉투, 아이콘 | 구매자 데몬이 인증 없이 읽어야 함 |
| **유료 봉투 (private/)** | **절대 공개 불가.** 지금 트리와 git 이력에 들어 있음 |
| keys.json, .env | git 밖 (이미 조치됨) |
| scripts/ (serve, publish, 키 도구) | 공개 무방 (코드) |

그래서 **"저장소를 public 으로 = 유료 유출"**, **"private 으로 = 구매자가 index 를 못 읽음"**.
답: 구매자는 GitHub 을 보지 않는다. **스토어 서버가 정본의 실행 사본을 서빙**하고,
GitHub 은 협업·이력·CI 판정의 자리로만 쓴다.

### 결정: 저장소는 private, 서빙은 스토어 서버

```
GitHub relay-store (private)          스토어 서버 (상시 실행 호스트)
  정본 트리 + CI 판정(validate)    →     git pull 사본 + serve.ts 그대로
  관리자 임명 = Collaborator             /index.json  /artifacts  /buy  /redeem
  push → CI 통과 → 자동 배포             keys.json 은 영구 디스크 — 배포와 무관하게 유지
                                        ↑ 구매자 데몬의 RELAY_STORE_INDEX 가 여기를 가리킴
```

**호스트 확정 (2026-08-11): Vercel.** 사용자가 이미 Pro 를 쓰고 있어 추가 비용 0,
상업 사용 제약 없음. Railway 는 더 이상 쓰지 않음(기각), Fly/VPS 는 대안으로만 기록.

Vercel 은 서버리스라 serve.ts 를 그대로 못 올린다 — 이 선택은 곧 **웹 카탈로그 작업을
앞당겨 스토어와 한 앱으로 합치는 것**이다 (원래 1단계 설계도의 "서버리스 함수 + 키 장부
DB" 가 정확히 이 모양이다).

### Vercel 판 구조

```
Musibe/relay-store (private, 한 저장소)
  index.json · artifacts/ · private/ · icons/     정본 (지금 그대로)
  scripts/                                        관리자 도구 + 로컬 serve (개발용으로 유지)
  web/                                            Next 앱 (신규) — Vercel 이 이 디렉토리를 배포
    ├ 카탈로그 화면  /  /p/<scope>/<name>          목업 3판 노션 문법 이식
    ├ /buy            결제 페이지 (serve.ts 의 HTML 포팅)
    ├ /api/pay/result 승인 + 키 발급 (Payple callback)
    ├ /api/redeem     키 확인 -> 임시 다운로드 토큰
    ├ /api/dl/<token> private 봉투 전송
    └ 빌드 스크립트    index.json + 무료 봉투 + 아이콘을 public/ 으로 복사 (CDN 정적)
                       private/ 은 복사하지 않는다 — 함수만 읽는다
```

- **상태 2개(키 장부, 임시 토큰)는 저장 드라이버로 추상화**: 로컬 개발 = 파일(keys.json),
  프로덕션 = Supabase(유료 조직 보유 확정). 임시 토큰(다운로드·주문)은 저장 대신 HMAC 서명 토큰 — 상태는 키 장부 표 하나로 줄어든다
- 관리자 키 발급·폐기: `ADMIN_SECRET` 으로 보호된 `/api/admin/keys` 를 로컬 스크립트가
  호출 (issue-key.ts 가 이 경로를 쓰도록 확장). Payple callback 이 부르는 함수와 동일 코드
- CI: 기존 validate 유지 + **Vercel 빌드의 prebuild 로도 validate 실행** — 깨진 정본은
  배포 자체가 실패한다
- 클라이언트 전환: `RELAY_STORE_INDEX=https://<배포 도메인>/index.json`
- Payple 라이브: 배포 도메인 확정 후 Payple 등록 도메인 확인·변경 -> `PAYPLE_MODE=live`

### 작업 목록 (Vercel 판)

| # | 일 | 규모 |
| --- | --- | --- |
| V1 | web/ Next 스캐폴드 + 빌드 시 정본 복사 (index, 무료 봉투, 아이콘) | 반나절 |
| V2 | 저장 드라이버 (파일/Supabase) + HMAC 토큰 + keys 로직 이사 | 소 |
| V3 | /buy, /api/pay/result, /api/redeem, /api/dl 포팅 (로직은 serve.ts 검증본) | 반나절 |
| V4 | 카탈로그 화면 (목업 이식: 카드, 상세, 요구 블록, 콘솔에서 열기) | 1일 |
| V5 | 로컬 E2E (파일 드라이버로 전 구간) | 소 |
| V6 | Vercel 프로젝트 연결 + Supabase 테이블 생성(SQL 1회) + env + 원격 E2E | 반나절 |

V1~V5 는 로컬에서 완결 가능. V6 만 Vercel 대시보드 접근이 필요하다
(프로젝트 import, Upstash 연동, env 입력).

- 유료 봉투가 이력에 있어도 저장소가 private 이라 무해. **영구히 private 유지** —
  공개 전환이 필요해지면 이력 세척이 선행 조건
- 공개 발견용 웹 카탈로그(추후)는 GitHub 이 아니라 이 서버의 index 를 읽는 별도 정적
  사이트 — 저장소 공개가 영원히 불필요
- 대안(기각): public 저장소 + Pages 정적 + 유료만 별도 스토리지 + 별도 redeem 함수.
  CDN 정석이지만 조각이 셋으로 늘고 코드 변경이 큼. 트래픽이 커지면 정적 서빙만
  CDN 으로 분리하는 개선으로 되돌아온다

### 배포 전 코드 준비 (소폭)

1. serve.ts: `KEYS_PATH` env 지원 — 키 장부를 저장소 밖 볼륨(/data/keys.json)에.
   지금은 ROOT/keys.json 고정이라 재배포마다 장부가 초기화될 위험
2. serve.ts: 결제 완료 페이지의 콘솔 링크(127.0.0.1:4747)는 **구매자 컴퓨터의 콘솔**이라
   그대로 옳음 — 주석으로 의도 명시
3. issue/revoke 키 도구도 KEYS_PATH 를 따르게
4. 로컬 테스트 키 장부는 로컬에 남기고, 서버 볼륨은 빈 장부로 시작

### 절차 (반나절)

| # | 일 | 비고 |
| --- | --- | --- |
| 1 | 코드 준비 (위 4개) | 30분 |
| 2 | GitHub Musibe 에 **private** 저장소 생성 + push | CI(validate)가 첫 관문 |
| 3 | 스토어 서버 배포 | 호스트는 위 후보에서 선정 (미정). 영구 디스크 1개, env: PAYPLE_* (라이브 키), KEYS_PATH |
| 4 | 클라이언트 전환 | `RELAY_STORE_INDEX=https://<서버>/index.json` — https 라 기판 검증 통과 |
| 5 | E2E | 원격 인덱스로 무료 설치 + 키 발급·redeem + (데모) 결제 |
| 6 | 도메인 + Payple 라이브 | 등록 도메인을 서버에 붙인 뒤 `PAYPLE_MODE=live`. 소액 실결제 1건 + 즉시 취소로 마감 검증 |

### 이 계획이 지키는 것

- 규율 1: 클라이언트는 URL 하나만 바뀐다 (로컬 8787 → https 서버)
- 규율 2·3: 키 장부는 서버 볼륨, 유료 봉투는 비공개 유지
- 관리자 임명 경로가 실체를 얻는다: private 저장소 Collaborator + Railway 멤버 + Payple 부계정

## 7. 검토 시 정해야 할 것

| # | 결정 | 권고 |
| --- | --- | --- |
| 1 | 정본 저장소 위치 | 깃허브 신규 저장소 `relay-store` (조직: Musibe — 확정). Pages 로 서빙 |
| 2 | 공식 인덱스 URL | 도메인 없이 Pages URL 로 시작, 도메인은 나중에 CNAME 만 |
| 3 | 웹 카탈로그 저장소·배포 | 별도 저장소 + Vercel 정적 |
| 4 | 초기 등재 5종의 seller 표기 | `@yuni` 그대로 둘지 `@relay` 로 통일할지 |

넷 다 구현을 막지 않는 수준이며, 1·4 만 5번 작업 전에 정해지면 된다.
