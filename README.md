# Naver Blog Auto · 블로그 스튜디오

인스타그램 사진을 바탕으로 네이버 블로그 글을 준비하는 로컬 관리자 프로그램입니다. 현재 버전은 신규 프로젝트의 개발 기반과 콘텐츠 등록·중복 검사까지 구현합니다. 실제 네이버 로그인, 카테고리 조회, 인스타그램 수집, AI 글 작성의 화면 연동, 자동 발행은 다음 단계입니다. URL을 등록해도 외부 콘텐츠를 수집하거나 발행하지 않습니다.

## 기술 스택

- Next.js 16 App Router, React 19, TypeScript: 관리자 화면과 API
- Playwright: 브라우저 자동화 기반 및 E2E 테스트
- Node.js 내장 SQLite: 블로그 설정, 콘텐츠 URL, 이미지 중복 검사 기록
- Sharp: 이미지 디코딩과 파일·픽셀 SHA-256 계산
- Python 3.12 + Pillow: 로컬 이미지 확대 처리
- OpenAI SDK: 사진 분석과 SEO 초안 작성용 서버 측 함수

## 설치 및 실행

Node.js 24 이상과 Python 3.12 이상을 사용합니다. `.nvmrc`는 Node.js 24를 지정합니다.

```bash
cd naver-blog-auto
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r python/requirements.txt
npm run db:init
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 관리자 인증이 없는 로컬 개발용이므로 공개 인터넷에 노출하지 마세요. 개발 서버는 기본적으로 모든 인터페이스에 바인딩합니다. 개인 PC에서 로컬에만 바인딩하려면 `npm run dev -- --hostname 127.0.0.1`을 사용하세요.

1. **블로그 연결**에서 블로그 이름과 URL에 포함된 블로그 ID를 입력합니다. 네이버 로그인 ID나 비밀번호를 입력하는 화면이 아닙니다.
2. 카테고리를 쉼표로 직접 등록하고 기본 카테고리를 선택합니다. 설정을 저장해도 로그인 상태는 **로그인 대기**입니다.
3. **콘텐츠 관리**에서 HTTPS 인스타그램 게시물(`/p/`) 또는 릴스(`/reel/`) URL을 등록합니다. 쿼리와 fragment를 제거해 중복 등록을 막습니다.
4. JPEG, PNG, WebP 이미지를 업로드해 중복 검사 기록을 등록합니다. 최대 10MB·2,500만 화소, 정적 이미지를 지원합니다.

이미지는 파일 해시와 EXIF 방향을 적용한 sRGB RGBA 픽셀 해시로 비교합니다. 같은 픽셀을 가진 PNG가 다르게 인코딩되어도 중복으로 판단합니다. 크롭, 리사이즈, 손실 재압축된 유사 이미지 검사는 아직 지원하지 않습니다. 원본 이미지 파일은 저장하지 않으며, 게시물과 이미지 연결·수집 파이프라인도 다음 단계입니다. 화면에는 최근 100개 기록을 표시합니다.

## 데이터와 설정

첫 DB 접근 또는 `npm run db:init` 실행 시 `data/blog.sqlite`와 `profile`, `posts`, `images` 테이블을 생성합니다. URL 및 이미지 해시에 UNIQUE 제약을 사용하며, WAL 모드와 busy timeout을 설정합니다. 앱을 재시작해도 데이터는 유지됩니다. `.env.example`을 참고해 필요할 때만 `.env.local`을 생성하세요. 인증 정보는 현재 단계에서 필요하지 않습니다.

| 설정 | 기본값 | 용도 |
| --- | --- | --- |
| `DATA_DIR` | 작업 디렉터리 기준 `./data` | SQLite 보관 경로 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwright 설치 브라우저 | 시스템 Chromium을 사용할 때의 실행 파일 경로 |
| `OPENAI_API_KEY` | 없음 | 향후 실제 AI 함수를 명시적으로 호출할 때만 필요한 서버 설정 |

`db:init`, Python, 테스트 명령은 `.env.local`을 자동으로 읽지 않습니다. 별도 데이터 경로가 필요하면 `DATA_DIR=/원하는/경로 npm run db:init`처럼 프로세스 환경에 지정하세요. 키·비밀번호·브라우저 세션 파일을 Git에 커밋하지 마세요. 현재 앱은 네이버 세션이나 비밀번호를 저장하지 않습니다. API는 Zod 검증과 교차 출처 변경 요청 거부를 적용하지만, 인증·권한·운영용 업로드 제한은 배포 전에 추가해야 합니다.

## 검증

```bash
npm run test
npm run build
npm run typecheck
.venv/bin/python -m unittest discover -s python -v
# 최초 1회: Playwright 관리 Chromium 설치
npx playwright install chromium
npm run test:e2e
```

이미 시스템 Chromium이 있으면 다운로드 대신 다음처럼 사용합니다.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

E2E는 포트 3100에 자체 개발 서버를 실행하고 임시 디렉터리의 별도 DB를 사용합니다. 블로그 설정 저장·새로고침 후 유지, 카테고리 선택, URL 정규화와 중복 오류, 이미지 업로드와 중복 오류, 모바일 너비를 검증합니다. 실제 네이버·인스타그램·OpenAI에는 접속하지 않습니다.

프로덕션 모드의 로컬 검증은 `npm run build` 후 `npm start`로 실행합니다. 런타임에도 Node.js 24와 쓰기 가능한 `DATA_DIR`이 필요합니다. 읽기 전용·서버리스 배포에는 현재 SQLite 구조를 그대로 사용하지 마세요.

## Python 이미지 확대

```bash
.venv/bin/python python/upscale.py input.png data/upscaled/output.png --scale 2
```

2·3·4배 Lanczos 보간 확대를 지원합니다. 이는 AI 초해상도가 아닌 기본 이미지 처리입니다. 원본과 기존 출력 파일은 덮어쓰지 않습니다. JPEG·PNG·WebP 정적 이미지만 지원하며 출력은 최대 1억 화소입니다. 웹 업로드 화면과는 아직 연결하지 않았습니다.

## 프로젝트 구조

```text
src/app/                 관리자 페이지와 API(profile, posts, images)
src/components/          반응형 관리자 화면
src/lib/db.ts            SQLite 스키마·저장 함수
src/lib/validation.ts    블로그 설정·URL 검증
src/lib/images.ts        이미지 중복 판별
src/lib/automation/      Playwright 브라우저 생성 기반
src/lib/ai/              OpenAI 사진 분석·SEO 초안 함수
python/                  이미지 확대 CLI와 테스트
scripts/                 DB 초기화
tests/                   저장·API 단위 테스트 및 브라우저 E2E
data/                    로컬 DB(자동 생성, Git 제외)
```

`createNaverBrowser()`는 격리된 브라우저 컨텍스트만 생성합니다. 호출자는 사용 후 `context.close()`로 종료해야 합니다. 로그인이나 발행을 수행하지 않습니다. OpenAI 함수는 서버에서 명시적으로 호출해야 하며, 현재 UI와 API는 이를 실행하거나 유료 요청을 보내지 않습니다. 다음 단계에서는 사용자 검토를 포함한 실제 계정 연결, 서비스 정책에 맞는 수집, 카테고리 조회, 초안 생성, 발행 검증을 구현합니다.

## 클라우드 환경

클라우드 작업은 이미 격리되어 있으므로 기존 `/workspace/naver-blog-auto` 체크아웃을 사용합니다. 별도 Git worktree는 만들 필요가 없습니다. 설치 단계에는 잠금 파일을 사용하는 `npm ci`, Python 가상환경, DB 초기화를 사용하고, 새 작업에서는 개발 서버를 다시 시작합니다. 패키지 다운로드는 npm/PyPI 접근이 필요합니다. 이번 단계의 실행·테스트에는 네이버 인증 정보와 OpenAI 키가 필요하지 않습니다.
