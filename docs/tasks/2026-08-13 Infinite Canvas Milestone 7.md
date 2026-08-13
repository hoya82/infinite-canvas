# Infinite Canvas — Milestone 7 (도큐먼트 관리)

작성일: 2026-08-13
상태: 구현 완료(자동 검증 완료), 브라우저 수동 검증은 이후 체크포인트에서 진행

## 개요

지금까지는 부트스트랩이 만든 도큐먼트 하나만 존재했다. 여러 도큐먼트를 만들고, 목록에서 전환하고, 이름을 바꾸고, 지울 수 있는 UI를 붙인다. 또한 M2에서 렌더링 파이프라인은 이미 준비해뒀지만 UI가 없어 미뤄뒀던 **배경 색상/텍스처 변경**도 이 마일스톤에서 마저 연결했다 — 도큐먼트 단위 설정이라 스위처 패널에 자연스럽게 묶인다.

## 구현 내용

- `documentManager.ts` — "현재 열려 있는 도큐먼트"만 아는 `document.svelte.ts`와 달리, **OPFS를 진실 공급원으로 삼아 하이드레이션 여부와 무관하게** 도큐먼트 컬렉션 전체를 다룬다.
  - `listDocumentSummaries()` — 파일명이 곧 제목(`{title}.infcanvas`)이라는 M1의 설계를 그대로 활용해, **컨테이너를 하나도 열지 않고** 디렉터리 목록만으로 전체 도큐먼트 id+제목을 나열한다.
  - `renameDocument(id, newTitle)` — 픽셀을 전혀 건드리지 않는다. 컨테이너를 열어 `manifest.title`만 고치고 새 파일명으로 다시 쓴 뒤(재인코딩 없음, zip 재압축만) 옛 파일을 지운다. 자동 저장 파일이 있으면 같은 방식으로 함께 옮긴다. 지금 Dexie에 하이드레이션되어 있지 않은(즉 현재 열려 있지 않은) 도큐먼트에도 그대로 동작한다.
  - `deleteDocument(id)` — OPFS 디렉터리와 Dexie 작업 영역(문서/레이어/타일/픽셀/텍스처)을 모두 정리한다.
- `document.svelte.ts`에 `setBackgroundColor`/`setBackgroundTexture` 추가. 텍스처는 업로드된 이미지를 `OffscreenCanvas`에 그린 뒤 M1과 같은 규칙(`resolveTileWebpQuality`)으로 즉시 webp로 변환해 저장한다 — 저장 시점이 아니라 업로드 시점에 한 번만 인코딩해, 이후 매 저장마다 다시 변환하지 않는다.
- `persistence.ts`의 `saveDocument`가 이제 배경 텍스처를 실제로 컨테이너에 포함한다(M2/M6까지는 `textures: []`로 비워뒀던 부분).
- `bootstrap.ts`의 `hydrateDocumentFromOpfs`에 텍스처 하이드레이션을 추가했다 — 컨테이너에 텍스처가 있으면 `textures` 테이블에 복원해, 다시 열었을 때 배경 이미지가 실제로 보이게 했다(이전까지는 컨테이너에 텍스처를 넣어도 다시 열면 사라졌을 버그였다).
- `DocumentSwitcher.svelte` — 현재 도큐먼트 제목을 누르면 열리는 패널: 도큐먼트 목록(클릭해서 열기, 더블클릭해서 이름 인라인 편집, 삭제 버튼), 새 도큐먼트 생성 폼, 그리고 배경 설정(색상 피커, 텍스처 업로드 버튼 — 숨긴 파일 입력을 통해).
- `Toolbar.svelte`에 `DocumentSwitcher`를 맨 왼쪽에 배치.

## 검증

- `documentManager.svelte.spec.ts`(실제 OPFS/IndexedDB를 쓰는 브라우저 테스트): 목록이 컨테이너를 열지 않고도 정확한지, rename이 Dexie에 열려있지 않은 도큐먼트에도 동작하고 재하이드레이션 후에도 제목이 유지되는지, 현재 열려 있는 도큐먼트를 rename하면 Dexie 상태도 함께 갱신되는지, delete가 OPFS와 Dexie를 모두 정리하는지 — 4개 전부 통과.
- 전체 스위트 46개(M1~M7 누적) 통과, `svelte-check` 0 에러, lint 통과, 빌드 성공.
- 브라우저 수동 검증(패널 UX, 텍스처 업로드 후 실제 타일링, 도큐먼트 전환 시 캔버스/레이어 패널이 정확히 갱신되는지)은 이후 체크포인트에서 진행한다.

## 다음

M8(내보내기)에서 서버로 내보내는 fetch API 준비와 로컬 다운로드 액션을 추가하면 계획했던 8개 마일스톤이 모두 끝난다.
