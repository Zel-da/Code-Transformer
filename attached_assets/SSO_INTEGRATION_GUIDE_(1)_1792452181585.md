# DX Dashboard Hub SSO 연동 가이드

외부 프로그램 개발자·관리자를 위한 단일 연동 문서

작성·운영 확인: 2026-10-14 KST | 기준: 현재 서버 구현 및 공개 운영 엔드포인트

## 1. 먼저 읽을 결론

이 프로그램은 그룹웨어 계정으로 사용자를 인증하고 외부 웹 앱에 로그인 정보를 전달하는 **SSO 제공자**입니다. 외부 앱은 **서버가 있는 웹 앱**으로 구현하십시오.

**연동 순서: 클라이언트 등록 → 외부 앱 서버 설정 → 로그인 리다이렉트 → 코드 교환 → 사용자 정보 확인 → 외부 앱 세션 생성.**

이 문서에는 실제 운영 주소, 클라이언트 발급 절차, API 계약, 복사 가능한 전체 Node.js 서버 코드, 실행 방법, 오류별 처리, 운영 점검 항목이 들어 있습니다. 앱별 Client ID·Client Secret은 아래 등록 절차에서 발급되는 값입니다. 외부 앱에 배포하는 공통 비밀키는 없으며, 이 문서에 비밀값을 넣지 않습니다.

### 현재 반드시 지켜야 하는 제한

- **완전한 표준 OpenID Connect 제공자가 아닙니다.** Authorization Code 형태의 직접 HTTP 연동을 사용하십시오.
- **Discovery 자동 설정을 사용하지 마십시오.** 현재 운영 Discovery 응답에 개발 주소가 들어 있습니다.
- **JWKS와 ID Token이 없습니다.** 일반적인 OIDC 플러그인을 설정만 해서 연결하는 방법은 현재 지원하지 않습니다.
- **PKCE, Refresh Token, Token Revocation, 통합 로그아웃은 구현되어 있지 않습니다.**
- 인증은 앱 접근 권한 전체를 의미하지 않습니다. **대시보드 권한·외부 앱 관리자 권한은 외부 앱에서 별도로 판단**해야 합니다.
- 브라우저 전용 SPA, 모바일 앱, 데스크톱 앱에 Client Secret을 넣지 마십시오. 그런 앱은 자신의 백엔드를 통해 연동해야 합니다.

## 2. 운영 주소와 필요한 설정

### 2.1 고정 운영 주소

| 항목 | 실제 값 |
| --- | --- |
| SSO_BASE_URL | https://SSC-DashboardHub.replit.app |
| 중앙 로그인 | https://SSC-DashboardHub.replit.app/login |
| 클라이언트 관리 | https://SSC-DashboardHub.replit.app/admin/sso-clients |
| 관리자 테스트 | https://SSC-DashboardHub.replit.app/admin/sso-test |
| 브라우저 인증 페이지 | https://SSC-DashboardHub.replit.app/sso/authorize |
| 토큰 교환 POST | https://SSC-DashboardHub.replit.app/api/sso/token |
| 사용자 정보 GET | https://SSC-DashboardHub.replit.app/api/sso/userinfo |
| 클라이언트 공개 정보 GET | https://SSC-DashboardHub.replit.app/api/sso/client-info |
| Discovery GET — 자동 연동에 사용 금지 | https://SSC-DashboardHub.replit.app/api/sso/.well-known/openid-configuration |

2026-10-14 확인 시 공개 운영 서버가 실행 중입니다. 외부 서버의 HTTPS 요청에 중앙 사이트의 브라우저 쿠키가 필요하지 않습니다.

### 2.2 앱마다 정해야 하는 값

| 이름 | 얻는 방법·용도 |
| --- | --- |
| Client ID | 중앙 관리자 화면에서 등록 후 발급. `sso_…` 형식. 공개 가능한 앱 식별자 |
| Client Secret | 생성 또는 재발급 시 한 번 표시. 외부 앱 서버의 Secrets에 저장 |
| APP_BASE_URL | 외부 앱의 브라우저 공개 주소. 예: `https://your-app.example.com` |
| Redirect URI | 외부 앱이 직접 구현할 콜백. 예: `https://your-app.example.com/sso/callback` |
| 외부 앱 SESSION_SECRET | 외부 앱 자체 쿠키 서명용 난수. 중앙 서버의 키와 별개 |
| 외부 앱 DATABASE_URL | 외부 앱 자체 세션을 저장할 PostgreSQL 연결 설정 |

`your-app.example.com`은 예시이며 실제 서비스 주소로 바꾸십시오. 외부 앱의 주소는 중앙 SSO 주소와 다릅니다.

**외부 앱에 전달하지 않는 값:** 중앙 서버의 `JWT_SECRET`, `SESSION_SECRET`, 그룹웨어 비밀번호, `DX_INTEGRATION_API_KEY`. 조직 데이터 API 키는 SSO Client Secret이 아닙니다.

## 3. 중앙 관리자: 앱 등록부터 비밀키 재발급까지

1. 중앙 `/login`에서 그룹웨어 이메일·비밀번호로 로그인합니다.
2. ADMIN 계정으로 `/admin/sso-clients`에 들어갑니다.
3. **클라이언트 등록**을 누릅니다.
4. 앱 이름을 입력합니다. 예: `재고관리 시스템`.
5. 허용 Redirect URI에 외부 앱의 콜백 주소를 **한 줄에 하나씩** 입력합니다.
6. 생성 후 표의 **Client ID**를 기록합니다.
7. 팝업에 한 번 표시되는 **Client Secret**을 외부 앱의 서버 Secrets에 안전하게 저장합니다.
8. 상태가 **활성**인지 확인합니다.

권장: 개발용과 운영용은 클라이언트를 각각 등록하고 다른 Secret을 사용하십시오.

### Redirect URI 등록 규칙

- 등록된 문자열과 요청 문자열이 **정확히 일치**해야 합니다.
- `http`/`https`, 포트, 경로, 대소문자, 마지막 `/`, 고정 쿼리까지 동일하게 맞춥니다.
- 와일드카드, 서브도메인 패턴, 부분 경로 매칭이 없습니다.
- 등록에는 `?code=…&state=…`를 넣지 않습니다. 이는 인증 후 중앙 서버가 붙입니다.
- Fragment(`#…`) 없이, 가능하면 고정 쿼리 없는 콜백을 사용합니다.
- 개발 예시: `http://localhost:3000/sso/callback`.
- 운영 예시: `https://your-app.example.com/sso/callback`.
- 브라우저가 돌아가는 PC가 아닌 다른 서버의 `localhost`로 콜백을 등록하지 마십시오.
- 외부 앱이 하위 경로에 있다면 해당 경로까지 포함하여 등록하고 외부 앱 라우터·쿠키 경로를 함께 맞춥니다. 뒤의 샘플은 루트 경로 배포용입니다.

### Secret을 잃어버렸거나 유출했을 때

클라이언트 관리 화면에서 **Secret 재발급**을 사용합니다. 이전 Secret은 새로운 토큰 교환에 사용할 수 없게 됩니다. 외부 앱 Secrets를 새 값으로 바꾸고 해당 앱 서버를 재시작·재발행합니다. 앱 설정 변경 후 실제 로그인 흐름으로 확인하십시오.

클라이언트 비활성화·삭제는 새 코드 발급·토큰 교환을 막습니다. **이미 발급한 Access Token을 즉시 폐기하지는 않습니다.** 자세한 내용은 9장을 따르십시오.

## 4. 전체 인증 흐름

```text
① 사용자 → 외부 앱 /sso/login
② 외부 앱 서버: 무작위 state 생성·서버 세션에 5분 보관
③ 브라우저 → 중앙 /sso/authorize?client_id=...&redirect_uri=...&response_type=code&state=...
④ 중앙: 그룹웨어 인증 또는 기존 로그인 상태 확인
⑤ 중앙 → 외부 앱 /sso/callback?code=...&state=...
⑥ 외부 앱 서버: 저장한 state와 돌아온 state 비교·1회 소비
⑦ 외부 앱 서버 → 중앙 POST /api/sso/token (Secret 포함, 서버 간)
⑧ 외부 앱 서버 → 중앙 GET /api/sso/userinfo (Bearer Access Token)
⑨ 외부 앱 서버: sub와 활성 상태 확인, 로컬 접근 정책 적용
⑩ 외부 앱 서버: 세션 ID 재생성 후 자체 로그인 세션 생성
```

`state`는 CSRF 방지용 난수입니다. 중앙은 state를 전달할 뿐 검증하지 않습니다. 외부 앱이 반드시 검증해야 합니다. 사용자의 비밀번호는 중앙 인증 화면에만 입력하며 외부 앱은 수집하지 않습니다.

중앙의 브라우저 로그인 상태가 정상적으로 남아 있으면 바로 인증을 진행합니다. 새 브라우저, 만료된 쿠키, 브라우저의 저장 상태에 따라 로그인 화면이 다시 나올 수 있습니다. 숨겨진 iframe 방식은 사용하지 마십시오. 중앙 서버는 iframe 표시를 차단합니다.

## 5. API 계약: 이름·형식 그대로 사용

### 5.1 인증 페이지 — 브라우저 최상위 이동

```http
GET /sso/authorize?client_id=CLIENT_ID&redirect_uri=URL_ENCODED_CALLBACK&response_type=code&state=RANDOM_STATE
```

| 파라미터 | 필수 여부 | 설명 |
| --- | --- | --- |
| client_id | 필수 | 등록된 활성 클라이언트의 ID |
| redirect_uri | 필수 | 등록된 콜백과 정확히 일치하는 URL |
| response_type | 명시 권장 | `code`만 지원. 생략 시 현재 구현의 기본값은 code |
| state | 연동에서는 필수 | 외부 앱이 만든 난수. 서버는 없다고 막지 않으므로 외부 앱이 강제 |

URL은 문자열을 이어 붙이지 말고 `URL`과 `URLSearchParams`로 조립하십시오. `scope`, `nonce`, `code_challenge`로 권한이나 보안 기능이 활성화되지 않습니다.

인증 완료 시 콜백에는 `code`와 전달했던 `state`가 붙습니다. 코드 유효 시간은 **300초**, 정상 사용은 **1회**입니다. 사용자 취소·로그인 실패는 중앙 화면에 남을 수 있으며 표준 OAuth의 `error` 콜백을 항상 보내는 구현은 아닙니다.

### 5.2 토큰 교환 — 외부 앱 서버에서만 호출

```http
POST https://SSC-DashboardHub.replit.app/api/sso/token
Content-Type: application/json
```

```json
{
  "code": "CALLBACK_AUTHORIZATION_CODE",
  "client_id": "CLIENT_ID",
  "client_secret": "SERVER_STORED_CLIENT_SECRET",
  "redirect_uri": "https://your-app.example.com/sso/callback"
}
```

- JSON 또는 `application/x-www-form-urlencoded` 본문을 받습니다.
- 인증 정보는 **본문**으로 전송합니다. HTTP Basic만 보내는 방식은 지원하지 않습니다.
- 위 네 값이 필수입니다. **인증 페이지의 `client_id`와 코드·콜백의 소속 클라이언트가 같아야 합니다.**
- `grant_type`은 현재 구현에서 검사하지 않습니다. 표준 표기로 `authorization_code`를 추가해도 되지만 이를 기능 지원의 근거로 해석하지 마십시오.
- `redirect_uri`에는 콜백에서 받은 `code`, `state`를 붙이지 않습니다.
- timeout 후 **같은 코드를 자동 재시도하지 마십시오.** 서버가 이미 코드를 소비했을 수 있습니다. 새 로그인 흐름을 시작합니다.

성공: HTTP 200

```json
{
  "access_token": "EXAMPLE_ACCESS_TOKEN_NOT_A_REAL_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "user": {
    "sub": "123",
    "email": "example@soosan.co.kr",
    "name": "예시 사용자",
    "department": "예시팀",
    "rank": "과장",
    "system_role": "USER",
    "role_name": null,
    "employee_id": "EXAMPLE001",
    "company": "예시회사",
    "aud": "CLIENT_ID"
  }
}
```

예시 사용자·사번은 가상 값입니다. 실제 필드는 다음 표를 따릅니다.

### 5.3 사용자 정보 조회 — 검증·최신 상태 확인용

```http
GET https://SSC-DashboardHub.replit.app/api/sso/userinfo
Authorization: Bearer ACCESS_TOKEN
```

성공: HTTP 200

```json
{
  "sub": "123",
  "email": "example@soosan.co.kr",
  "name": "예시 사용자",
  "department": "예시팀",
  "rank": "과장",
  "system_role": "USER",
  "role_name": null,
  "employee_id": "EXAMPLE001",
  "company": "예시회사",
  "is_active": true
}
```

외부 앱 서버가 HTTPS로 교환하여 받은 Token을 가지고 이 엔드포인트를 호출하십시오. 브라우저가 직접 보낸 `user` 객체, JWT를 단순 base64 디코딩한 내용, 쿼리의 이메일만으로 로그인시키지 마십시오.

현재 userinfo는 Token의 사용자 식별값으로 DB의 **현재 사용자 정보·활성 여부**를 다시 조회합니다. Token 응답의 `user.aud`는 Client ID와 비교하십시오. userinfo 응답에는 `aud`가 없고, 현재 서버가 외부 앱의 Client ID를 별도로 검증하지 않으므로 **그 앱이 자체 콜백에서 직접 교환한 Token만 취급**하십시오.

### 5.4 필드 의미와 사용자 매핑

| 필드 | 형식 | 외부 앱 처리 |
| --- | --- | --- |
| sub | 숫자 형태의 문자열 | 중앙 사용자의 고유 ID. **외부 사용자 매핑의 기본키** |
| email | 문자열 | 연락·표시용. 바뀔 수 있으므로 단독 고유키로 쓰지 않음 |
| name | 문자열 | 표시 이름 |
| department | 문자열 또는 null | 기본 소속 부서 표시. 전체 계층 경로가 아님 |
| rank | 문자열 또는 null | 직급. enum으로 단정하지 말고 모르는 값·null 허용 |
| system_role | 문자열 | 중앙 시스템 권한. 통상 ADMIN/USER. 외부 앱 관리자 권한 아님 |
| role_name | 문자열 또는 null | 중앙에 할당된 역할명. 외부 앱 권한이나 허용 대시보드 목록 아님 |
| employee_id | 문자열 또는 null | 사번. 임시 값·미정리 값이 있을 수 있어 고유 매핑키로 단정하지 않음 |
| company | 문자열 또는 null | 회사 표시. 회사명을 자체 검증 없이 앱 접근 권한으로 쓰지 않음 |
| aud | 문자열 | 토큰 교환 응답 user에만 포함. 요청 Client ID와 같은지 비교 |
| is_active | boolean | userinfo에 포함. 정상 응답에서는 활성 사용자만 반환 |

JWT에는 추가로 `iat`, `exp`, `iss`가 들어갑니다. 외부 앱 DB는 `provider + sub` 조합을 유일하게 저장하는 것을 권장합니다. `provider`에는 고정 운영 제공자 식별값을 사용하고 운영·개발 DB의 sub가 같더라도 별도 제공자로 구분하십시오.

현재 SSO 응답에는 **전체 조직도, orgPath, 직책(position), 겸직 부서, dashboard ID, 개인별 허용 권한이 없습니다.** 조직 API와 SSO를 혼동하지 마십시오.

## 6. 복사하여 실행하는 Node.js 전체 예제

### 6.1 적용 범위

Node.js **22 이상**, Express, PostgreSQL을 사용하는 외부 웹 앱 예제입니다. 중앙 서버의 파일을 수정하는 코드가 아닙니다.

- 서버 세션은 PostgreSQL에 저장하여 재시작·다중 인스턴스에 대응합니다.
- Client Secret과 Access Token은 서버에만 보관합니다.
- state는 5분 후 만료시키고 콜백에서 소비합니다.
- 로그인 시 세션 ID를 새로 발급합니다.
- 보호 API를 호출할 때마다 userinfo로 토큰 만료·계정 비활성화를 확인합니다.
- 외부 앱 ADMIN 권한을 자동으로 부여하지 않습니다.
- 선택적 `ALLOWED_SSO_SUBS`로 앱 접근을 제한할 수 있습니다.
- 중앙 연결 장애 때 보호 API는 **허용하지 않고 503**을 반환합니다.

기존 앱에 붙일 때는 기존 세션·DB·권한 정책과 합치십시오. 아래 예제는 독립 앱으로도 실행됩니다.

### 6.2 외부 앱 파일과 설치

새 외부 앱 폴더에서:

```bash
npm init -y
npm install express@5 express-session@1 connect-pg-simple@10 pg@8
```

프로젝트에 `.env`와 `app.mjs`를 생성하십시오. 아래 값을 외부 앱의 실제 설정으로 바꿉니다.

```dotenv
SSO_BASE_URL=https://SSC-DashboardHub.replit.app
SSO_CLIENT_ID=발급받은_Client_ID
SSO_CLIENT_SECRET=발급받은_Client_Secret
APP_BASE_URL=http://localhost:3000
DATABASE_URL=외부_앱_PostgreSQL_연결_URL
SESSION_SECRET=외부_앱만의_충분히_긴_무작위_값
PORT=3000
NODE_ENV=development
TRUST_PROXY_HOPS=0
ALLOWED_SSO_SUBS=
```

- 로컬에서는 위 APP_BASE_URL과 `http://localhost:3000/sso/callback`을 함께 사용합니다.
- 운영에서는 APP_BASE_URL을 **외부 앱의 HTTPS 운영 주소**로, NODE_ENV를 `production`으로 바꿉니다.
- Reverse Proxy가 정확히 한 단계이고 앱으로 직접 들어오는 요청이 차단된 환경이면 `TRUST_PROXY_HOPS=1`입니다. 다른 구성은 신뢰할 프록시 수를 맞추십시오. 무조건 모든 프록시를 신뢰하지 마십시오.
- TLS가 필요한 DB는 그 DB 공급자의 연결 설정을 따르십시오. 인증서 검증을 끄는 임시 우회 설정은 사용하지 않습니다.
- `ALLOWED_SSO_SUBS=123,456`이면 지정한 중앙 사용자만 허용합니다. 빈 값은 모든 인증된 활성 사용자에게 예제 로그인 기능을 열어 둡니다. **업무 시스템 운영 시 자체 접근 정책을 반드시 적용**하십시오.
- SESSION_SECRET은 외부 앱 PC에서 다음 명령으로 생성할 수 있습니다. 중앙 서버의 키를 복사하지 않습니다.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`.env`, 로그, DB 백업을 외부에 공개하지 마십시오. Git에는 `.env`를 제외하고, 운영에서는 서버의 Secrets 기능을 사용하십시오.

### 6.3 외부 앱 DB: 세션 테이블

외부 앱의 PostgreSQL에서 1회 실행합니다. **중앙 SSO DB가 아닙니다.**

```sql
CREATE TABLE IF NOT EXISTS sso_web_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS sso_web_sessions_expire_idx
  ON sso_web_sessions (expire);
```

실행 계정에 테이블 SELECT/INSERT/UPDATE/DELETE 권한이 필요합니다. 세션 JSON에는 토큰이 들어가므로 DB 접근·백업 권한을 제한합니다. 연동 대상 앱이 중앙 사용자·대시보드 테이블을 직접 읽을 필요는 없습니다.

### 6.4 app.mjs — 전체 코드

```javascript
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { randomBytes, timingSafeEqual } from "node:crypto";

const required = [
  "SSO_BASE_URL", "SSO_CLIENT_ID", "SSO_CLIENT_SECRET",
  "APP_BASE_URL", "DATABASE_URL", "SESSION_SECRET"
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
}
const base = process.env.SSO_BASE_URL.replace(/\/+$/, "");
const appBase = process.env.APP_BASE_URL.replace(/\/+$/, "");
const providerURL = new URL(base);
const appURL = new URL(appBase);
if (providerURL.protocol !== "https:" || providerURL.pathname !== "/" ||
    providerURL.search || providerURL.hash || providerURL.username) {
  throw new Error("SSO_BASE_URL must be an HTTPS origin");
}
if (appURL.pathname !== "/" || appURL.search || appURL.hash || appURL.username) {
  throw new Error("This sample requires an origin-only APP_BASE_URL");
}
const production = process.env.NODE_ENV === "production";
if (production && appURL.protocol !== "https:") {
  throw new Error("Production APP_BASE_URL must use HTTPS");
}
if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must have at least 32 characters");
}
const redirectUri = `${appBase}/sso/callback`;
const clientId = process.env.SSO_CLIENT_ID;
const allowedSubs = new Set(
  (process.env.ALLOWED_SSO_SUBS ?? "").split(",").map(v => v.trim()).filter(Boolean)
);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on("error", () => console.error("Session database connection failed"));
const PgStore = connectPgSimple(session);
const app = express();
app.disable("x-powered-by");
const hops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
if (!Number.isInteger(hops) || hops < 0) throw new Error("Invalid TRUST_PROXY_HOPS");
if (hops) app.set("trust proxy", hops);
app.use(express.urlencoded({ extended: false, limit: "8kb" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(session({
  name: "dx_client_session",
  secret: process.env.SESSION_SECRET,
  store: new PgStore({
    pool, tableName: "sso_web_sessions", createTableIfMissing: false
  }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true, secure: production, sameSite: "lax",
    path: "/", maxAge: 3600_000
  }
}));

const save = req => new Promise((ok, fail) =>
  req.session.save(err => err ? fail(err) : ok()));
const regenerate = req => new Promise((ok, fail) =>
  req.session.regenerate(err => err ? fail(err) : ok()));
async function destroy(req, res) {
  await new Promise((ok, fail) =>
    req.session.destroy(err => err ? fail(err) : ok()));
  res.clearCookie("dx_client_session", {
    path: "/", httpOnly: true, secure: production, sameSite: "lax"
  });
}
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function validUser(u) {
  return u && typeof u.sub === "string" && /^\d+$/.test(u.sub) &&
    typeof u.email === "string" && typeof u.name === "string";
}
function allowed(user) {
  return allowedSubs.size === 0 || allowedSubs.has(user.sub);
}
class ProviderError extends Error {
  constructor(stage, status) {
    super("SSO provider request failed");
    this.stage = stage;
    this.status = status;
  }
}
async function provider(path, init = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init, signal: AbortSignal.timeout(15_000), redirect: "error"
    });
  } catch {
    throw new ProviderError(path, 0);
  }
  if (!response.ok) throw new ProviderError(path, response.status);
  try { return await response.json(); }
  catch { throw new ProviderError(path, 502); }
}
function userinfo(token) {
  return provider("/api/sso/userinfo", {
    headers: { Authorization: `Bearer ${token}` }
  });
}

app.get("/", (req, res) => {
  const logoutForm = req.session.auth
    ? `<form method="post" action="/logout">
         <input type="hidden" name="csrf" value="${req.session.csrf}">
         <button>이 앱에서 로그아웃</button></form>`
    : "";
  // csrf is generated as hex, not user-provided HTML.
  res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8">
    <title>DX SSO 연동 예제</title><h1>DX SSO 연동 예제</h1>
    <p><a href="/sso/login">그룹웨어 계정으로 로그인</a></p>
    <p><a href="/me">내 정보 확인</a></p>${logoutForm}</html>`);
});

app.get("/sso/login", async (req, res) => {
  const state = randomBytes(32).toString("hex");
  req.session.pending = (req.session.pending ?? [])
    .filter(p => p.expiresAt > Date.now()).slice(-4);
  req.session.pending.push({ state, expiresAt: Date.now() + 300_000 });
  await save(req); // Save before browser leaves this origin.
  const url = new URL(`${base}/sso/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", state
  }).toString();
  res.redirect(302, url.toString());
});

app.get("/sso/callback", async (req, res) => {
  const { code, state } = req.query;
  const pending = req.session.pending ?? [];
  const index = pending.findIndex(p =>
    p.expiresAt > Date.now() && equal(p.state, state));
  if (typeof code !== "string" || !code || index < 0) {
    return res.status(400).send("Invalid or expired state. Restart at /sso/login.");
  }
  pending.splice(index, 1);
  req.session.pending = pending;
  await save(req); // State is consumed even if the exchange fails.
  const token = await provider("/api/sso/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code, client_id: clientId,
      client_secret: process.env.SSO_CLIENT_SECRET,
      redirect_uri: redirectUri
    })
  });
  if (typeof token.access_token !== "string" ||
      token.token_type !== "Bearer" || token.expires_in !== 3600 ||
      !validUser(token.user) || token.user.aud !== clientId) {
    throw new ProviderError("/api/sso/token", 502);
  }
  const user = await userinfo(token.access_token);
  if (!validUser(user) || user.sub !== token.user.sub || user.is_active !== true) {
    throw new ProviderError("/api/sso/userinfo", 502);
  }
  if (!allowed(user)) return res.status(403).send("This app does not permit this user.");
  await regenerate(req); // Prevent session fixation.
  req.session.auth = {
    user, accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000
  };
  req.session.csrf = randomBytes(32).toString("hex");
  await save(req);
  res.redirect(303, "/me"); // Leave code/state out of the subsequent URL.
});

async function requireSso(req, res, next) {
  const auth = req.session.auth;
  if (!auth || auth.expiresAt <= Date.now()) {
    if (auth) await destroy(req, res);
    return res.status(401).json({ error: "login_required", login_url: "/sso/login" });
  }
  let user;
  try { user = await userinfo(auth.accessToken); }
  catch (err) {
    if (err instanceof ProviderError && err.status === 401) {
      await destroy(req, res);
      return res.status(401).json({ error: "login_required", login_url: "/sso/login" });
    }
    return res.status(503).json({ error: "sso_temporarily_unavailable" });
  }
  if (!validUser(user) || user.sub !== auth.user.sub || user.is_active !== true) {
    await destroy(req, res);
    return res.status(401).json({ error: "invalid_identity" });
  }
  if (!allowed(user)) return res.status(403).json({ error: "access_denied" });
  req.session.auth.user = user;
  req.ssoUser = user;
  next();
}
app.get("/me", requireSso, (req, res) => res.json(req.ssoUser));
// Add requireSso AND your app's authorization middleware to each protected route.

app.post("/logout", async (req, res) => {
  if (req.get("origin") !== appURL.origin ||
      !equal(req.session.csrf, req.body.csrf)) {
    return res.status(403).send("Invalid logout request");
  }
  await destroy(req, res);
  res.redirect(303, "/");
});
app.use((err, _req, res, _next) => {
  // Never log callback URL, code, token, secret, session ID or request body.
  console.error("SSO flow failed", {
    stage: err instanceof ProviderError ? err.stage : "local",
    status: err instanceof ProviderError ? err.status : 500
  });
  res.status(502).send("SSO failed. Restart at /sso/login; do not reuse the code.");
});
const port = Number(process.env.PORT ?? "3000");
app.listen(port, "0.0.0.0", () => console.log(`Listening on port ${port}`));
```

### 6.5 실행 및 운영 설정

로컬에서:

```bash
node --env-file=.env app.mjs
```

브라우저로 `http://localhost:3000`을 열고 로그인 링크를 누릅니다. 브라우저에서 중앙 인증을 마치면 외부 앱 `/me`에 사용자 JSON이 표시됩니다.

운영에서는 공급한 Secrets를 환경변수로 로드하고 `node app.mjs`를 실행합니다. APP_BASE_URL, 등록된 Redirect URI, HTTPS, NODE_ENV, 신뢰 프록시 설정, 실제 PORT를 운영 환경에 맞춥니다. 개발 `.env`를 운영 이미지에 포함하지 않습니다.

**성공 기준:** 콜백 후 외부 앱 DB에 세션이 만들어지고, `/me`는 200, 로그아웃 후 `/me`는 401입니다. 브라우저에는 HttpOnly 세션 쿠키만 있고 Access Token·Client Secret은 응답·localStorage·sessionStorage에 없어야 합니다.

사용자 프로필을 HTML로 표시하는 앱은 name·email·department 등을 HTML escape하십시오. 프록시와 웹서버 접근 로그에서도 콜백의 **쿼리 문자열을 저장하지 않도록 설정**하고 세션 쿠키·인증 헤더·본문을 마스킹하십시오.

## 7. 다른 언어·프레임워크에서 구현할 때

동일한 규칙으로 어떤 서버 언어에도 연결할 수 있습니다. 프레임워크의 일반 HTTP 클라이언트·서버 세션을 사용합니다.

1. 사용자 로그인 시작 라우트에서 최소 32바이트 난수 state를 서버 세션에 저장합니다.
2. 중앙 인증 페이지로 GET 리다이렉트합니다.
3. 콜백에서 state, 만료, code 형식을 검사하고 state를 소비합니다.
4. 서버 HTTP 클라이언트로 토큰 교환 POST를 보냅니다.
5. 응답의 `user.aud === 설정한 Client ID`를 확인합니다.
6. 받은 토큰으로 userinfo를 조회하고 두 응답의 sub를 비교합니다.
7. `is_active === true`와 로컬 접근 정책을 확인합니다.
8. 세션 ID를 재생성하고 외부 앱의 사용자 세션을 만듭니다.
9. 만료 시 Refresh Token을 쓰지 말고 새 인증 흐름을 시작합니다.
10. 계정 비활성화를 빠르게 반영하려면 보호 요청 시 userinfo를 확인합니다.

SPA의 `/sso/login`, `/sso/callback`, userinfo 호출은 SPA 자체가 아니라 앱의 백엔드/BFF에서 처리합니다. 프런트엔드는 자체 세션 쿠키로 외부 앱 API를 이용합니다.

### curl로 확인할 최소 호출

아래 환경변수는 **개발자 자신의 PC에서** 설정합니다. 실제 값을 문서·채팅에 붙이지 마십시오.

```bash
# 공개 클라이언트 정보: Secret 없이 등록 확인
curl --get 'https://SSC-DashboardHub.replit.app/api/sso/client-info' \
  --data-urlencode "client_id=$SSO_CLIENT_ID"

# 브라우저 인증 후 받은 5분 이내 코드로 서버에서 교환
curl --fail-with-body \
  'https://SSC-DashboardHub.replit.app/api/sso/token' \
  --data-urlencode "code=$SSO_AUTH_CODE" \
  --data-urlencode "client_id=$SSO_CLIENT_ID" \
  --data-urlencode "client_secret=$SSO_CLIENT_SECRET" \
  --data-urlencode "redirect_uri=$SSO_REDIRECT_URI"

# 반환된 Access Token으로 사용자 확인
curl --fail-with-body \
  'https://SSC-DashboardHub.replit.app/api/sso/userinfo' \
  --header "Authorization: Bearer $SSO_ACCESS_TOKEN"
```

테스트 터미널의 토큰 출력은 공유·녹화·로그 수집하지 마십시오. curl은 API만 점검하며 state 검증·브라우저 쿠키·로그인 세션 전체를 검증하지 않습니다.

## 8. 오류별 원인과 바로 할 조치

서버 오류 본문은 통상 `{"error":"설명"}`입니다. 표준 OAuth `error_description` 형식으로 가정하지 않습니다.

| 단계·증상 | 원인 | 처리 |
| --- | --- | --- |
| 인증 페이지: client_id 또는 redirect_uri 누락 | URL 파라미터 누락 | URLSearchParams로 두 값을 포함 |
| 인증 페이지: code만 지원 | response_type 불일치 | `response_type=code`로 변경 |
| client-info 400 `client_id required` | 쿼리 누락 | client_id 쿼리 추가 |
| client-info 404 `등록되지 않은 클라이언트입니다.` | 미등록 또는 비활성 | 운영 DB에 등록한 Client ID인지, 활성인지 확인 |
| 코드 발급 400 `허용되지 않은 redirect_uri입니다.` | 콜백 문자열 불일치 | 관리자 등록·인증 요청·토큰 요청의 URL을 동일하게 설정 |
| 코드 발급 401 | 중앙 로그인 세션 없음·만료 | 중앙 로그인 화면에서 다시 로그인 후 외부 앱 로그인 시작 |
| 토큰 400 `code, client_id, client_secret, redirect_uri 필수` | 본문 필수 값 누락 | JSON/폼 본문과 서버 환경변수 확인 |
| 토큰 401 `클라이언트 인증 실패` | 잘못된 ID·Secret, 비활성 클라이언트 | 같은 환경의 값인지 확인. Secret 유실 시 재발급하고 외부 서버 설정 교체 |
| 토큰 400 `유효하지 않거나 만료된 코드입니다.` | 5분 경과·사용 완료·다른 ID·다른 콜백 | 콜백 새로고침이나 재시도 대신 새 로그인 시작 |
| 토큰 401 `비활성화된 사용자입니다.` | 사용자가 비활성 또는 없음 | 중앙 관리자에서 의도된 비활성 여부 확인. 외부 앱 우회 허용 금지 |
| 토큰·userinfo 500 `서버 설정 오류` | 중앙 JWT 서명키 미설정 | 중앙 서버의 기존 JWT_SECRET 등록·운영 적용 확인. 외부 앱에 키 전달 금지 |
| userinfo 401 `Bearer token required` | 인증 헤더 없음·형식 오류 | 정확히 `Authorization: Bearer 토큰` 전송 |
| userinfo 401 `유효하지 않은 토큰입니다.` | 만료·위조·키 변경 | 외부 세션 삭제 후 새 로그인 |
| userinfo 401 `사용자를 찾을 수 없습니다.` | 삭제·비활성 사용자 | 외부 세션 삭제, 권한 허용하지 않음 |
| 외부 콜백 Invalid state | 쿠키 누락, origin 변경, 오래된 로그인, state 재사용 | 외부 앱 APP_BASE_URL과 브라우저 주소 통일, Lax 쿠키·HTTPS·프록시 확인 후 새 로그인 |
| 로그인 후 무한 루프 | 콜백 라우터·세션 저장·쿠키 설정 오류 | state 저장 완료 후 redirect, HTTP/HTTPS 맞춤, 프록시 trust·DB 권한 확인 |
| 중앙 로그인 401 | 그룹웨어 계정/암호 오류·허용 도메인 불일치 | 중앙 화면에서 그룹웨어 계정 확인. 기본 도메인은 soosan.co.kr |
| 중앙 로그인 403 | 계정 비활성 | 관리자에서 사용자 상태 확인 |
| 중앙 로그인 429 | 로그인 요청 제한 | 15분 내 최대 30회 제한. 대기 후 재시도, 자동 로그인 반복 중지 |
| 연결 timeout·502·503 | 중앙 또는 외부 세션 DB 장애 | 로그인·권한 허용하지 않음. 상태 복구 후 새 로그인, 코드 자동 재전송 금지 |
| OIDC 설정에서 issuer/JWKS 오류 | 표준 OIDC 자동 연동을 사용함 | 2장의 운영 URL을 직접 설정하고 6장 HTTP 교환 방식 사용 |

로그인 실패 상태를 해결할 때 그룹웨어 비밀번호를 외부 앱 서버·API에 보내지 마십시오. 중앙 로그인 상태가 꼬이면 중앙 `/login`에서 정상 로그인한 뒤 외부 앱의 `/sso/login`을 다시 시작하십시오.

## 9. 토큰·로그아웃·접근 제어의 실제 동작

### 토큰 수명·검증

- 인증 코드: 300초.
- Access Token: 3600초, HS256 JWT.
- Refresh Token 없음. 만료 시 새 인증을 시작합니다.
- 공개키 검증용 JWKS 없음. 중앙 서명키를 외부 앱에 공유하지 않습니다.
- 제공자의 `SSO_BASE_URL`이 설정되어 있으면 JWT issuer는 그 값입니다. 미설정 시 JWT issuer는 `soosan-dashboard-manager`입니다.
- Discovery의 fallback issuer는 개발 주소이므로 JWT issuer와 다를 수 있습니다. Discovery를 인증 근거로 사용하지 않습니다.
- 운영 제공자 관리자는 추후 중앙 `SSO_BASE_URL`을 실제 운영 주소로 맞출 수 있지만, 그것만으로 JWKS·ID Token·표준 OIDC 지원이 생기지는 않습니다.

### 로그아웃·폐기

- 외부 앱 `/logout`: 해당 앱의 세션만 삭제합니다.
- 중앙 `/api/auth/logout`: 중앙 쿠키 세션을 삭제합니다. 브라우저 중앙 세션 전용이며 외부 Access Token용 로그아웃 API가 아닙니다.
- 중앙에서 로그아웃해도 이미 발급된 외부 Access Token은 즉시 무효화되지 않습니다.
- 클라이언트 Secret 재발급·비활성화·삭제 역시 기존 Token의 즉시 폐기를 보장하지 않습니다.
- 사용자 비활성화는 이후 userinfo 조회에서 거부됩니다. 매 요청 조회하지 않는 앱은 자체 재검증 주기만큼 반영이 늦어질 수 있습니다.
- 중앙 JWT_SECRET 변경은 기존 Token에 영향을 주므로 정상적인 외부 앱 연동 과정에서는 변경하지 않습니다.
- 즉시 통합 로그아웃·앱별 Token 폐기가 필수인 시스템은 **현재 지원 범위 밖**입니다. 구현 없이 지원된다고 간주하지 마십시오.

### 외부 앱 접근·관리자 권한

현재 활성 중앙 사용자에게 활성 클라이언트의 코드를 발급할 때, 해당 앱의 대시보드 접근 권한을 별도로 검사하지 않습니다. 따라서 SSO 성공만으로 해당 업무 화면을 모두 열면 안 됩니다.

외부 앱은 로컬 사용자 매핑, 허용 사용자 목록, 자체 역할/권한으로 화면·API 접근을 통제하십시오. `system_role=ADMIN`은 중앙 관리자의 의미이며 **외부 앱의 superuser로 자동 변환하지 않습니다.** `role_name`만으로 허용 여부를 판단하지 마십시오.

중앙 `/api/portal/dashboards`는 중앙 로그인 컨텍스트용입니다. SSO Token으로 대시보드 권한을 조회하는 공개 외부 API로 문서화·사용하지 않습니다.

## 10. 중앙 관리자용 API 참고

일반 연동 개발자는 화면으로 등록하면 충분합니다. 자동화가 필요한 관리자에게만 해당합니다.

관리 API는 **중앙의 유효한 로그인 세션 + ADMIN**이 필요합니다. 외부 앱의 Access Token은 관리자 인증 수단이 아닙니다. 쿠키를 문서·클라이언트 앱에 복사하지 마십시오.

| 메서드·경로 | 요청 | 결과 |
| --- | --- | --- |
| GET /api/admin/sso-clients | 본문 없음 | 배열: id, clientId, name, allowedRedirectUris, isActive, createdAt |
| POST /api/admin/sso-clients | name, allowedRedirectUris 배열 | 등록 정보와 **clientSecret 최초 1회 반환** |
| PUT /api/admin/sso-clients/:id | name, allowedRedirectUris, isActive, regenerateSecret 중 필요한 값 | 수정 정보. regenerateSecret=true이면 새 clientSecret 최초 1회 반환 |
| DELETE /api/admin/sso-clients/:id | 본문 없음 | `{"success":true}` |
| POST /api/admin/sso-clients/:id/test-token | 본문 필요 없음 | 현재 ADMIN 사용자의 access_token, expires_in, user |

`:id`는 중앙 DB의 숫자 클라이언트 ID이고 `sso_…` Client ID 문자열과 다릅니다. 필수 입력 누락은 400, 인증 없음은 401, ADMIN 아님은 403, 수정/삭제 대상 없음은 404입니다. 생성 응답에는 구현상 내부 정보가 추가될 수 있으므로 필요 필드만 취급하고 전체 응답을 로그에 남기지 않습니다.

관리자 테스트는 **관리자 자신의 Token 발급 시뮬레이션**입니다. Secret·Redirect URI·브라우저 state·외부 앱 callback을 검사하지 않으므로 성공했다고 실제 연동이 완료된 것은 아닙니다.

중앙 인증 화면 내부는 `/api/sso/code`를 사용합니다. 직접 붙일 필요가 없습니다. 내부 POST 본문은 `clientId`, `redirectUri`, `state`의 camelCase이며 외부 Token API의 snake_case와 다릅니다. 중앙 세션으로 인증하며 성공 응답은 `{"code":"…","state":"…"}`입니다.

## 11. 완료 판정 체크리스트

- [ ] 운영과 개발 클라이언트를 구분했다.
- [ ] 운영 주소는 2장의 실제 주소이며 Discovery의 개발 주소를 쓰지 않았다.
- [ ] 중앙 관리자가 외부 앱의 정확한 Redirect URI를 등록하고 활성화했다.
- [ ] 외부 앱 서버에 Client ID·Secret·APP_BASE_URL·세션 DB·SESSION_SECRET을 설정했다.
- [ ] Secret, Token, 비밀번호가 브라우저 저장소·번들·URL·로그에 없다.
- [ ] 실제 사용자가 브라우저에서 중앙 로그인 후 외부 콜백으로 돌아온다.
- [ ] state 누락·변조·만료·재사용 시 로그인을 거부한다.
- [ ] 코드 교환과 userinfo는 서버 간 HTTPS로만 수행한다.
- [ ] Token user의 aud와 설정 Client ID, 두 응답의 sub를 확인한다.
- [ ] 부서·직급·역할·사번의 null과 변경을 처리한다.
- [ ] 새 로그인 시 세션 ID를 재생성하고 세션은 공유 DB에 저장한다.
- [ ] 중앙 ADMIN을 외부 앱 ADMIN으로 자동 변환하지 않는다.
- [ ] 외부 앱 자체 접근 권한을 적용한다.
- [ ] Token 만료 시 새 인증, userinfo 401 시 세션 삭제를 수행한다.
- [ ] 중앙 장애 시 보호 화면·API를 허용하지 않는다.
- [ ] 외부 로그아웃 후 보호 API는 401이다.
- [ ] Secret 재발급 후 새 값으로 로그인되고 이전 값으로는 교환이 실패한다.
- [ ] 비활성 사용자의 userinfo 조회가 거부되어 외부 앱 세션이 끊긴다.
- [ ] 관리자 테스트뿐 아니라 실제 브라우저 로그인부터 콜백까지 검증했다.

## 12. 이 문서의 검증 범위와 유지보수

현재 코드의 SSO·로그인·관리 화면 구현을 읽고, 운영의 인증 페이지 200, Discovery 200, JWKS 404, Token 없는 userinfo 401, 미등록 client-info 404를 확인했습니다.

이 문서 작성 때문에 운영 클라이언트·Secret·사용자·서명키·서버 코드를 생성하거나 변경하지 않았습니다. 실제 발급된 자격증명으로 운영 로그인·Token 교환까지 실행한 것은 아닙니다. 포함된 샘플은 문법 검사와 모의 제공자를 사용하는 13개 검증을 통과했습니다. 실제 앱의 최종 검증은 11장의 체크리스트대로 수행합니다.

프로젝트 유지보수 시 문서에 실제 포함된 샘플을 검사하고 HTML 문서를 다시 생성하는 명령:

```bash
node --experimental-vm-modules scripts/verify_sso_guide.mjs
python scripts/render_sso_guide.py
```

모의 검증에는 로그인·정보 조회, state 변조/만료/재사용 차단, audience·사용자 불일치 차단, 로컬 접근 제한, Token 만료·userinfo 거부·비활성 사용자 처리, 중앙 장애 시 거부, 로그아웃 CSRF 검증이 포함됩니다. PostgreSQL 드라이버·실제 브라우저·운영 자격증명의 통합 검증을 대신하지는 않습니다.

중앙 서버의 인증 방식·응답 필드·주소를 바꾸면 이 문서를 함께 갱신하십시오. 문서에 없는 표준 OAuth/OIDC 기능을 추정해서 구현하지 마십시오.
