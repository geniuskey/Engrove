import { defineConfig } from 'vitepress';

const repository = 'https://github.com/geniuskey/Engrove';

export default defineConfig({
  base: '/Engrove/',
  cleanUrls: true,
  description:
    'Engrove는 엔지니어링 데이터, 시험 근거, 주요 일정과 실행 작업을 하나의 추적 가능한 흐름으로 연결하는 셀프 호스팅 워크스페이스입니다.',
  head: [
    ['link', { href: '/Engrove/engrove-favicon.png', rel: 'icon', type: 'image/png' }],
    ['meta', { content: '#07111f', name: 'theme-color' }],
    ['meta', { content: 'summary_large_image', name: 'twitter:card' }],
    ['meta', { content: 'Engrove — 엔지니어를 위한 데이터 워크스페이스', property: 'og:title' }],
    [
      'meta',
      {
        content:
          '측정, 사양, 근거, 대시보드와 프로젝트 작업을 추적 가능한 하나의 흐름으로 연결합니다.',
        property: 'og:description',
      },
    ],
  ],
  lang: 'ko-KR',
  lastUpdated: true,
  markdown: {
    lineNumbers: true,
  },
  sitemap: { hostname: 'https://geniuskey.github.io/Engrove/' },
  themeConfig: {
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'GitHub에서 이 문서 편집',
    },
    footer: {
      copyright: 'Copyright © Engrove contributors',
      message: 'AGPL-3.0-only로 배포되는 Engrove Community 문서',
    },
    logo: {
      alt: 'Engrove',
      dark: '/engrove-mark-dark.png',
      light: '/engrove-mark-light.png',
    },
    nav: [
      { link: '/app-introduction', text: '앱 소개' },
      { link: '/guide/getting-started', text: '시작하기' },
      {
        items: [
          { link: '/operations/api-access', text: 'API와 SDK' },
          { link: '/operations/self-hosting', text: '셀프 호스팅' },
          { link: '/operations/administrator-guide', text: '관리자 가이드' },
        ],
        text: '운영',
      },
      { link: repository, text: 'GitHub' },
    ],
    outline: { label: '이 페이지에서', level: [2, 3] },
    search: { provider: 'local' },
    sidebar: [
      {
        items: [
          { link: '/app-introduction', text: 'Engrove 소개' },
          { link: '/guide/getting-started', text: '빠른 시작' },
          { link: '/guide/concepts', text: '구조와 핵심 개념' },
          { link: '/guide/work-management', text: '주요 일정과 작업 관리' },
          { link: '/guide/api-and-operations', text: 'API와 운영 개요' },
        ],
        text: '제품 가이드',
      },
      {
        collapsed: false,
        items: [
          { link: '/product/task-collaboration', text: '작업 협업' },
          { link: '/product/task-workflow', text: '작업 워크플로' },
          { link: '/product/task-automation', text: '작업 자동화' },
          { link: '/product/record-comments', text: '레코드 댓글' },
          { link: '/product/public-view-sharing', text: '공개 뷰 공유' },
        ],
        text: '기능 안내',
      },
      {
        collapsed: true,
        items: [
          { link: '/operations/self-hosting', text: '셀프 호스팅' },
          { link: '/operations/administrator-guide', text: '관리자 가이드' },
          { link: '/operations/api-access', text: 'API 접근' },
          { link: '/operations/webhooks', text: '웹훅' },
          { link: '/operations/oidc-keycloak', text: 'OIDC와 Keycloak' },
          { link: '/operations/backup-restore', text: '백업과 복구' },
          { link: '/operations/observability', text: '관측 가능성' },
          { link: '/operations/security-checklist', text: '보안 체크리스트' },
        ],
        text: '설치와 운영',
      },
      {
        collapsed: true,
        items: [
          { link: '/adr/', text: '아키텍처 결정 기록' },
          { link: '/development/project-loop', text: '품질 검증 루프' },
          { link: '/product/engrove-development-plan', text: '개발 계획' },
        ],
        text: '개발자 문서',
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
  },
  title: 'Engrove',
  titleTemplate: ':title · Engrove',
});
