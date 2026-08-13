import { defineConfig } from 'vitepress';

const repository = 'https://github.com/geniuskey/Engrove';

const koreanSidebar = [
  {
    items: [
      { link: '/app-introduction', text: 'Engrove 소개' },
      { link: '/guide/product-tour', text: '화면으로 보는 제품 투어' },
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
];

const englishSidebar = [
  {
    items: [
      { link: '/en/app-introduction', text: 'Introducing Engrove' },
      { link: '/en/guide/product-tour', text: 'Visual product tour' },
      { link: '/en/guide/getting-started', text: 'Quick start' },
      { link: '/en/guide/concepts', text: 'Structure and concepts' },
      { link: '/en/guide/work-management', text: 'Key dates and work' },
      { link: '/en/guide/api-and-operations', text: 'API and operations' },
    ],
    text: 'Product guide',
  },
  {
    collapsed: false,
    items: [
      { link: '/en/product/task-collaboration', text: 'Work collaboration' },
      { link: '/en/product/task-workflow', text: 'Workflows' },
      { link: '/en/product/task-automation', text: 'Automation' },
      { link: '/en/product/record-comments', text: 'Record comments' },
      { link: '/en/product/public-view-sharing', text: 'Public view sharing' },
    ],
    text: 'Features',
  },
  {
    collapsed: true,
    items: [
      { link: '/en/operations/self-hosting', text: 'Self-hosting' },
      { link: '/en/operations/administrator-guide', text: 'Administrator guide' },
      { link: '/en/operations/api-access', text: 'API access' },
      { link: '/en/operations/webhooks', text: 'Webhooks' },
      { link: '/en/operations/oidc-keycloak', text: 'OIDC and Keycloak' },
      { link: '/en/operations/backup-restore', text: 'Backup and restore' },
      { link: '/en/operations/observability', text: 'Observability' },
      { link: '/en/operations/security-checklist', text: 'Security checklist' },
    ],
    text: 'Install and operate',
  },
  {
    collapsed: true,
    items: [
      { link: '/en/adr/', text: 'Architecture decisions' },
      { link: '/en/development/project-loop', text: 'Project quality loop' },
      { link: '/en/product/engrove-development-plan', text: 'Development plan' },
    ],
    text: 'Developer documentation',
  },
];

export default defineConfig({
  base: '/Engrove/',
  cleanUrls: true,
  head: [
    ['link', { href: '/Engrove/engrove-favicon.png', rel: 'icon', type: 'image/png' }],
    ['meta', { content: '#07111f', name: 'theme-color' }],
    ['meta', { content: 'summary_large_image', name: 'twitter:card' }],
  ],
  lastUpdated: true,
  locales: {
    root: {
      description:
        'Engrove는 엔지니어링 데이터, 시험 근거, 주요 일정과 실행 작업을 하나의 추적 가능한 흐름으로 연결하는 셀프 호스팅 워크스페이스입니다.',
      head: [
        [
          'meta',
          { content: 'Engrove — 엔지니어를 위한 데이터 워크스페이스', property: 'og:title' },
        ],
        [
          'meta',
          {
            content:
              '측정, 사양, 근거, 대시보드와 프로젝트 작업을 추적 가능한 하나의 흐름으로 연결합니다.',
            property: 'og:description',
          },
        ],
      ],
      label: '한국어',
      lang: 'ko-KR',
      markdown: {
        codeCopyButton: { copiedText: '복사됨', tooltipText: '코드 복사' },
        container: {
          cautionLabel: '주의',
          dangerLabel: '위험',
          detailsLabel: '세부 정보',
          infoLabel: '정보',
          noteLabel: '참고',
          tipLabel: '팁',
          warningLabel: '경고',
        },
      },
      themeConfig: {
        darkModeSwitchLabel: '화면 모드',
        darkModeSwitchTitle: '어두운 테마로 전환',
        docFooter: { next: '다음 페이지', prev: '이전 페이지' },
        editLink: {
          pattern: `${repository}/edit/main/docs/:path`,
          text: 'GitHub에서 이 문서 편집',
        },
        footer: {
          copyright: 'Copyright © Engrove contributors',
          message: 'AGPL-3.0-only로 배포되는 Engrove Community 문서',
        },
        langMenuLabel: '언어 변경',
        lastUpdated: { text: '마지막 업데이트' },
        lightModeSwitchTitle: '밝은 테마로 전환',
        nav: [
          { link: '/app-introduction', text: '앱 소개' },
          { link: '/guide/product-tour', text: '제품 투어' },
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
        returnToTopLabel: '맨 위로',
        sidebar: koreanSidebar,
        sidebarMenuLabel: '메뉴',
        skipToContentLabel: '본문으로 건너뛰기',
      },
      title: 'Engrove',
      titleTemplate: ':title · Engrove',
    },
    en: {
      description:
        'Engrove is a self-hosted workspace that connects engineering data, test evidence, key dates, and execution work in one traceable flow.',
      head: [
        ['meta', { content: 'Engrove — the engineering data workspace', property: 'og:title' }],
        [
          'meta',
          {
            content:
              'Connect measurements, specifications, evidence, dashboards, and project work in one traceable flow.',
            property: 'og:description',
          },
        ],
      ],
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        editLink: {
          pattern: `${repository}/edit/main/docs/:path`,
          text: 'Edit this page on GitHub',
        },
        footer: {
          copyright: 'Copyright © Engrove contributors',
          message: 'Engrove Community documentation, released under AGPL-3.0-only',
        },
        nav: [
          { link: '/en/app-introduction', text: 'Introduction' },
          { link: '/en/guide/product-tour', text: 'Product tour' },
          { link: '/en/guide/getting-started', text: 'Get started' },
          { link: '/en/guide/api-and-operations', text: 'API & operations' },
          { link: repository, text: 'GitHub' },
        ],
        outline: { label: 'On this page', level: [2, 3] },
        sidebar: englishSidebar,
      },
      title: 'Engrove',
      titleTemplate: ':title · Engrove',
    },
  },
  markdown: {
    lineNumbers: true,
  },
  sitemap: { hostname: 'https://geniuskey.github.io/Engrove/' },
  themeConfig: {
    logo: {
      alt: 'Engrove',
      dark: '/engrove-mark-dark.png',
      light: '/engrove-mark-light.png',
    },
    search: {
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonAriaLabel: '문서 검색', buttonText: '검색' },
              modal: {
                backButtonTitle: '검색 닫기',
                displayDetails: '상세 목록 표시',
                footer: {
                  closeKeyAriaLabel: 'Esc',
                  closeText: '닫기',
                  navigateDownKeyAriaLabel: '아래쪽 화살표',
                  navigateText: '이동',
                  navigateUpKeyAriaLabel: '위쪽 화살표',
                  selectKeyAriaLabel: 'Enter',
                  selectText: '선택',
                },
                noResultsText: '검색 결과가 없습니다',
                resetButtonTitle: '검색 초기화',
              },
            },
          },
        },
      },
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: repository }],
  },
});
