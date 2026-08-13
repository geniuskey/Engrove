---
description: Engrove Community를 로컬에서 실행하고 핵심 사용자 흐름을 확인합니다.
title: 빠른 시작
---

# 빠른 시작

이 가이드는 개발 환경에서 Engrove Community를 실행하고, 제품의 핵심 구조를 가장 짧은 순서로
둘러보는 방법을 설명합니다.

## 준비 사항

- Node.js 24.13.0과 pnpm 10.29.2
- Python 3.13.12와 uv 0.10.0
- Docker Engine과 Docker Compose v2

저장소에 고정된 버전을 사용하는 것이 중요합니다. 다른 Node 버전에서는 엔진 경고가 발생하며,
프로덕션 검증 근거로 인정되지 않습니다.

## 로컬 실행

```bash
git clone https://github.com/geniuskey/Engrove.git
cd Engrove
cp .env.example .env
corepack enable
pnpm install --frozen-lockfile
uv sync --project apps/worker-python --locked
docker compose -f deploy/compose/compose.yaml up -d --build
```

브라우저에서 `http://localhost:4173`을 열고 `.env`의 개발용 설정 토큰으로
최초 설정을 완료합니다. 예제 자격 증명은 로컬 개발 외의 환경에서 사용하지 마세요.

## 먼저 둘러볼 다섯 곳

### 1. 워크스페이스 개요

현재 속한 그룹과 접근 가능한 프로젝트, 최근 작업, 주요 일정과 데이터를 확인합니다. 워크스페이스는
팀이 공유하는 데이터와 멤버십의 경계입니다.

### 2. 데이터 라이브러리

샘플·장비·재료처럼 여러 프로젝트가 함께 사용하는 구조를 확인합니다. 테이블을 열어 뷰를 바꾸고,
레코드 상세에서 측정·사양·근거·댓글·작업 연결을 살펴보세요.

### 3. 프로젝트의 주요 일정

시작일과 종료일을 중복 입력하는 간트가 아니라, 날짜 자체가 중요한 이벤트를 한 축에서 관리합니다.
일정에 작업을 연결하면 완료된 연결 작업 수로 진행 맥락이 자동 계산됩니다.

### 4. 작업

칸반·목록·달력을 전환하고 카드를 선택해 상세를 엽니다. 상태, 담당자, 우선순위, 하위 작업, 차단
관계, 작업 시간, 댓글과 근거를 한 패널에서 수정할 수 있습니다.

### 5. 대시보드와 검토

저장된 데이터 뷰로 차트를 만들고 대시보드에 배치합니다. 레코드 검토를 요청해 승인 또는 변경 요청이
어떻게 이력과 알림으로 남는지 확인합니다.

## API 확인

로컬 API 문서는 `http://localhost:3000/api/docs`에서 열 수 있습니다.
설정 메뉴의 API 토큰에서 필요한 기능 범위와 만료 기간만 선택해 토큰을 발급하세요. 토큰은 한 번만
표시되므로 비밀 저장소에 즉시 보관해야 합니다.

자세한 내용은 [API 접근 문서](/operations/api-access)와
[`@engrove/sdk` README](https://github.com/geniuskey/Engrove/tree/main/packages/sdk)를 참고하세요.

## 개발 검증

저장소의 전체 품질 게이트는 다음 한 줄로 실행합니다.

```bash
bash scripts/project-loop.sh
```

포맷, 린트, 타입, 단위·통합·브라우저 접근성 테스트, 프로덕션 사전 점검, 취약점, 빌드와 번들
예산을 모두 검사합니다. 자세한 기준은 [프로젝트 루프](/development/project-loop)에 있습니다.

## 다음 읽을거리

- [워크스페이스·프로젝트·데이터의 관계](/guide/concepts)
- [주요 일정과 작업 관리](/guide/work-management)
- [셀프 호스팅](/operations/self-hosting)
- [Community 관리자 가이드](/operations/administrator-guide)
