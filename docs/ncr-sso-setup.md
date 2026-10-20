# NCR · DX Dashboard Hub SSO 설정

## 중앙 관리자에게 전달할 정보

- 앱 이름: 공정 부적합 등록 및 관리 (NCR)
- 앱 운영 주소: https://code-transformer.replit.app
- 허용 Redirect URI: https://code-transformer.replit.app/api/auth/sso/callback
- 로그인 시작 주소: https://code-transformer.replit.app/api/auth/sso/login
- 클라이언트 관리: https://SSC-DashboardHub.replit.app/admin/sso-clients
- 클라이언트 상태: 활성

등록된 Redirect URI는 마지막 슬래시까지 정확히 일치해야 합니다.
개발용과 운영용 클라이언트는 구분하고 각각 자신의 앱 주소를 사용하세요.

## NCR 서버 설정

| 이름 | 값 또는 저장 방법 |
| --- | --- |
| SSO_BASE_URL | https://SSC-DashboardHub.replit.app |
| APP_BASE_URL | https://code-transformer.replit.app |
| SSO_CLIENT_ID | 중앙에서 발급받은 앱 식별자 |
| SSO_CLIENT_SECRET | 중앙에서 최초 한 번 표시하는 비밀값. 서버 Secrets로만 저장 |
| SESSION_SECRET | 기존 NCR 서버의 키 유지. SSO 토큰 암호화에도 사용 |
| DATABASE_URL | 기존 NCR 데이터베이스 유지 |

Secret은 채팅, 가이드, Git, 프런트엔드 환경변수에 넣지 않습니다.
운영 URL 두 개는 production 환경에 설정하고, 개발 환경에는 개발 클라이언트와 주소를 별도로 설정하세요.
설정 후 수정본을 게시해야 운영에 반영됩니다. API 서버 시작 시 SSO 전용 테이블을 추가하는 멱등 초기화가 실행됩니다. 기존 사용자/보고서 데이터와 권한은 변경하지 않습니다.

## 접근 및 계정 연결 정책

1. 중앙 SSO 활성 사용자 인증을 서버 간 HTTPS로 확인합니다.
2. 첫 연결 시 중앙이 확인한 이메일과 일치하는 NCR 활성 계정이 정확히 하나 있어야 합니다.
3. 연결 후에는 제공자 주소 + 중앙 sub를 고유 식별자로 사용합니다. 이후 이메일 변경만으로 다른 계정에 재연결하지 않습니다.
4. 미등록자, 중복 이메일, 이미 다른 중앙 사용자에 연결된 계정은 자동 생성하거나 덮어쓰지 않고 거부합니다.
5. NCR의 기존 역할을 그대로 사용합니다. 중앙 ADMIN을 NCR admin으로 자동 승격하지 않습니다.
6. 이메일 없는 관리자 아이디는 기존 내부 비밀번호 로그인으로 사용합니다.
7. 기존 그룹웨어/내부 폴백 로그인은 유지됩니다. SSO 계정의 비활성화는 SSO 세션을 거부하지만, 기존 로그인도 차단하려면 NCR 계정도 비활성화해야 합니다.
8. 보호 API마다 중앙 userinfo와 NCR 활성/현재 역할을 확인합니다. 중앙 장애 시 SSO 요청은 허용하지 않습니다.

## 세션과 보안

- 32바이트 난수 state, 5분 만료, 서버 DB에 해시로 저장, 콜백에서 원자적으로 1회 소비
- 인증 코드 자동 재시도 없음
- Token 응답의 aud와 Client ID, Token/userinfo의 sub 일치 여부 확인
- 새 로그인 시 별도 난수 세션 생성, 기존 SSO 세션 폐기
- 중앙 Access Token은 서버 DB에 AES-256-GCM으로 암호화해 보관
- 브라우저에는 HttpOnly·Secure·SameSite=Lax 쿠키만 전달
- SSO Token과 Client Secret은 브라우저 저장소나 번들로 전달하지 않음
- 쿠키 인증의 변경 요청과 로그아웃은 정확한 동일 출처 Origin 검사
- 만료 또는 중앙 userinfo 401이면 재로그인 필요
- NCR 로그아웃은 NCR 세션만 종료하며 중앙 대시보드의 통합 로그아웃은 아님
- SESSION_SECRET 교체 시 기존 JWT 및 SSO 세션도 다시 로그인해야 함
- 콜백 쿼리 문자열은 앱 요청 로그에서 제거하며 코드/토큰/쿠키/제공자 응답은 로그에 기록하지 않음

## 검증 범위

- 코드 수준 검증: 요청 state 누락·변조·만료·재사용, aud/sub 불일치, 미등록·비활성 사용자, 중앙 장애, 권한 승격 방지, 세션 폐기와 로그아웃 Origin 검사
- 단위/통합 테스트의 중앙 제공자 응답은 모의 응답이며 실제 운영 SSO 성공의 증거가 아닙니다.
- 실제 중앙 계정의 브라우저 로그인 → 코드 교환 → 콜백 → NCR 접속 → 로그아웃 검증은 앱 Client ID/Secret 설정과 운영 게시 후 수행해야 합니다.
- 이번 구현 대상은 웹 로그인입니다. Expo 네이티브 앱의 브라우저 인증/딥링크 연결은 별도 작업입니다.
