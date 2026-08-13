# Infinite Canvas — Milestone 2 (타일 렌더링과 뷰포트)

작성일: 2026-08-13
상태: 구현 완료 (자동 검증 완료, 브라우저 수동 검증은 M3와 함께 진행 예정)

## 개요

[Milestone 1](2026-08-13%20Infinite%20Canvas%20Milestone%201.md)에서 만든 저장/데이터 계층 위에, 실제로 화면에 무언가가 보이기 시작하는 단계다. 뷰포트(카메라) 상태, 패닝/줌 입력, 타일 로드/언로드, 배경+레이어 컴포지팅을 구현했다. 아직 그리기 기능은 없다(M3) — 이 마일스톤 단독으로는 "빈 배경이 보이고 패닝·줌이 되는" 상태까지다.

## 아이콘 사용 정책 (lucide-svelte 번들러 버그 실측)

이 마일스톤부터 UI 아이콘이 필요해질 것을 앞두고, 사용자가 지목한 lucide-svelte의 알려진 번들러 버그("아이콘 전체가 번들링되어 빌드 시간이 늘어난다")가 이 프로젝트의 실제 툴체인(SvelteKit + Vite 8/Rolldown)에서도 여전히 재현되는지 직접 측정했다.

- **barrel import** (`import { Pencil, Eraser } from 'lucide-svelte'`, 아이콘 2개만 사용): 프로덕션 빌드 12.19초, Svelte 컴파일 호출 1693회(사실상 전체 ~1600개 아이콘이 전부 컴파일됨) — `lucide-svelte`의 루트 진입점이 `./icons/index.js`를 통째로 재수출하기 때문.
- **deep import** (`import Pencil from 'lucide-svelte/icons/pencil'`): 동일한 아이콘 2개로 빌드 3.58초. 최종 번들 크기는 두 방식 모두 트리쉐이킹 후 동일(사용되지 않는 아이콘 이름이 산출물에 남지 않음을 확인) — 버그는 번들 크기가 아니라 **낭비되는 컴파일 시간**에 있다.

**결론 및 정책**: 이 저장소에서 lucide-svelte 아이콘은 항상 `lucide-svelte/icons/<kebab-case-이름>` 형태의 개별 딥 임포트만 사용한다. barrel import(`import { X } from 'lucide-svelte'`)는 사용하지 않는다. (메모리에도 기록: `project_lucide_icon_imports`)

## 구현 내용

- `viewport.svelte.ts` — `Viewport` 클래스(runes `$state`): `panX`/`panY`/`zoom` + 화면↔월드 좌표 변환, 화면 델타 기반 패닝(`panByScreenDelta`), 한 점을 고정한 채 확대/축소(`zoomAt`, 줌 범위 0.05~32로 제한), 뷰포트+마진에 걸치는 타일 좌표 범위 계산(`visibleTileRange`).
- `tileStore.ts` — 뷰포트 기반 타일 런타임 캐시. Dexie(`tilePixels`)의 원본 픽셀을 보이는 타일만 `OffscreenCanvas`로 디코딩해 올리고(`ensureLoaded`), 벗어난 타일은 메모리에서 내린다(`evictOutside`) — Dexie가 항상 최신 상태를 갖고 있으므로 안전하다. 레이어 컴포지팅 캐시는 두지 않고 렌더러가 매번 다시 그린다(타일 수가 적어 비용이 크지 않고, 조기 최적화를 피함).
- `document.svelte.ts` — 현재 도큐먼트/레이어 스택의 반응형 상태(`DocumentState`). `orderedLayers`는 `$derived`로 정렬 유지.
- `input.ts` — RxJS 기반 입력 스트림. `spaceHeld$`/`ctrlHeld$`(키보드) → `baseMode$`(`draw`/`pan`/`zoom`) 파생. 패닝·줌 드래그는 스트로크 FSM과 동일한 `exhaustMap`(제스처 시작) + `takeUntil`(pointerup/cancel 또는 모드 이탈에서 종료) 패턴으로 구현 — M3의 브러시 스트로크 FSM이 그대로 재사용할 수 있는 공통 기반이다.
- `renderer.ts` — 배경(색상 전체 채움, 또는 텍스처를 월드 좌표에 고정된 `createPattern`으로) 을 먼저 채우고, 그 위에 존재하는 타일만 레이어를 아래→위로 직접 메인 캔버스에 그린다. Canvas2D의 `globalCompositeOperation`이 "지금까지 그려진 결과"를 대상으로 합성되는 성질을 이용해 Normal/Multiply 블렌드를 별도 오프스크린 컴포지트 없이 정확하게 처리한다.
- `CanvasStage.svelte` — 캔버스 엘리먼트, DPR 대응 리사이즈(`ResizeObserver`), 입력 스트림 구독, `requestAnimationFrame`으로 묶은 온디맨드 렌더 스케줄링. 렌더 루프는 상시 루프가 아니라 pan/zoom/타일 로드 완료 등 실제 변경이 있을 때만 돈다.
- `+layout.svelte`/`+page.svelte`/`+layout.ts` — 전역 리셋 스타일, 앱 시작 시 `documentState.load()`(부트스트랩) 호출, 로딩 상태 표시 후 `CanvasStage` 마운트. `+layout.ts`에 `export const prerender = true`(M1에서 이미 추가).

## 발견 및 수정한 버그

`Viewport.visibleTileRange`의 최대 타일 인덱스 계산이 경계값에서 한 칸 더 포함되는 off-by-one 버그가 있었다 — `Math.ceil(right / TILE_SIZE)`를 그대로 "포함(inclusive) 최대 인덱스"로 썼는데, `right`는 배타적 경계이므로 경계가 정확히 타일 격자선과 겹칠 때(예: 뷰포트 오른쪽 끝이 정확히 1024일 때) 실제로는 보이지 않는 타일 한 칸이 더 로드 대상에 포함되는 문제였다. 유닛 테스트(`viewport.spec.ts`) 작성 중 발견했고 `Math.ceil(right / TILE_SIZE) - 1 + marginTiles`로 수정했다(같은 이유로 minX/minY는 `floor`라 문제 없음).

## 검증

- `viewport.spec.ts`(순수 로직, Node 환경): 좌표 변환 역함수 관계, 패닝, 앵커 고정 줌, 줌 범위 클램프, 타일 범위 계산(경계값·음수 좌표 포함) — 6개 전부 통과.
- `bun run check`(svelte-check) 0 에러, `bun run lint` 통과, `bun run build` 성공.
- 브라우저 수동 검증(패닝/줌이 실제로 자연스러운지, DPR 화면에서 흐릿하지 않은지)은 그릴 것이 있어야 의미가 커서 M3(드로잉)와 함께 한 번에 진행한다.

## 다음

M3(드로잉 엔진)에서 `input.ts`의 `baseMode$`/`pointerDown$`을 재사용해 펜 스트로크 FSM을 추가하고, 실제로 그림을 그린 뒤 M2에서 만든 렌더러가 그 결과를 제대로 보여주는지까지 함께 브라우저에서 확인한다.
