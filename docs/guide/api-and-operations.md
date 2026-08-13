---
description: Engrove의 REST API, TypeScript SDK, 웹훅과 셀프 호스팅 운영 경계를 소개합니다.
title: API와 운영 개요
---

# API와 운영 개요

Engrove의 브라우저 기능은 같은 권한과 무결성 규칙을 사용하는 REST API 위에 구축됩니다. UI에서만
가능한 비공개 기능을 만들지 않고, 통합 사용자가 안정적인 식별자와 명시적인 버전 계약을 사용할 수
있도록 설계합니다.

## API 표면

- `/api/v1` 아래의 버전 경로
- 실행 가능한 요청·응답 스키마를 포함한 OpenAPI 문서
- 기능 범위와 만료 기간을 제한하는 개인 API 토큰
- 검색과 페이지 정보를 가진 제한된 목록 API
- 생성 재시도를 위한 idempotency key
- 수정 충돌을 막는 row version
- 요청 ID, ETag와 할당량 헤더

설정 메뉴의 API 토큰에서 실제 필요한 기능만 선택하세요. 브라우저 세션 쿠키와 API 토큰은 용도와
보안 경계가 다릅니다.

## TypeScript SDK

`@engrove/sdk`는 런타임 의존성이 없는 타입 클라이언트입니다. 테이블 레코드와 프로젝트 작업을
페이지 단위로 순회하고, 생성·수정·일괄 변경·보관·복원·댓글·순위 이동을 수행할 수 있습니다.

```ts
import { EngroveClient } from '@engrove/sdk';

const engrove = new EngroveClient({
  baseUrl: 'https://engrove.example.com',
  token: process.env.ENGROVE_TOKEN!,
});

const tasks = engrove.tasks({ projectId, workspaceId });
for await (const task of tasks.all({ status: 'in_progress' })) {
  console.log(task.task_key, task.title);
}
```

SDK는 읽기와 동일한 idempotency key를 보존한 생성만 자동 재시도합니다. 버전이 오래된 수정은 최신
상태를 읽고 검토한 뒤 명시적으로 다시 수행해야 합니다.

## 웹훅

프로젝트 웹훅은 레코드와 작업 변경을 외부 시스템으로 전달합니다. 비밀은 생성 또는 회전 시 한 번만
표시되고, 각 요청은 HMAC 서명을 포함합니다. 전달 이력에서 실패 원인과 재시도를 확인할 수 있습니다.

## 셀프 호스팅 구조

| 구성 요소             | 책임                                  |
| --------------------- | ------------------------------------- |
| Web                   | React 정적 애플리케이션과 보안 헤더   |
| API                   | 인증, 권한, 도메인 트랜잭션과 OpenAPI |
| Node worker           | 웹훅, 내보내기, 알림과 내구성 작업    |
| Python worker         | 데이터셋 파싱과 과학 계산             |
| PostgreSQL            | 원본 데이터, 이력, 작업 상태와 outbox |
| Redis                 | 작업 큐와 런타임 조정                 |
| S3-compatible storage | 파일 버전과 파생 산출물               |

프로덕션 구성은 비루트·읽기 전용 컨테이너, 역할이 분리된 데이터베이스 계정, 범위 제한 스토리지
자격 증명, 사설 내부 포트와 TLS 프록시를 전제로 합니다.

## 운영 기준

- 배포 전 환경 파일과 Compose 구성을 비밀 출력 없이 검사합니다.
- liveness, readiness, Prometheus metrics와 구조화 로그를 제공합니다.
- age로 암호화하고 체크섬을 검증하는 fresh-install 백업·복구 절차를 사용합니다.
- OIDC Authorization Code + PKCE를 지원하며 로컬 인증을 복구 경로로 유지할 수 있습니다.
- 전체 프로젝트 루프가 포맷, 타입, 테스트, 접근성, 취약점과 번들 예산을 검사합니다.

구체적인 설치·보안 절차는 [셀프 호스팅](/operations/self-hosting), [보안 체크리스트](/operations/security-checklist),
[백업과 복구](/operations/backup-restore)를 따르세요. API 예제 전체는 [API 접근](/operations/api-access),
이벤트 계약은 [웹훅](/operations/webhooks)에 있습니다.
