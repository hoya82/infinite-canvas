# Infinite Canvas — Milestone 1 (기반 작업)

작성일: 2026-08-13
상태: 계획 승인 완료, 구현 착수

## 개요

무한 캔버스(Infinite Canvas) 드로잉 앱의 최초 계획 수립 과정과 결과를 기록한다. 브라우저 전용(서버 없음) Krita 스타일 페인팅 앱으로, 512×512 타일이 무한히 확장되는 그리드 위에 다중 레이어·다중 도큐먼트를 지원한다. 이 문서는 계획 수립 중 오간 결정 사항을 시간순으로 남기고, 전체 아키텍처와 Milestone 1(기반 작업)의 범위를 정리한다. 전체 계획 원문은 세션의 plan 파일에 있으며, 이후 마일스톤은 이 문서와 같은 규칙으로 `docs/tasks/`에 별도 파일로 남긴다.

## 최초 요구사항 요약

- 고정 크기(512×512) 투명 캔버스를 3×3 타일 형태로 무한 확장.
- 브라우저 전용 구동, filesystem API + IndexedDB(Dexie)로 자료구조 유지, 서버 export용 fetch API는 준비만 해둠.
- 다중 도큐먼트, 도큐먼트당 다중 레이어. 확장되는 모든 타일은 동일한 레이어 구조 공유. 타일은 섬처럼 고립되어 존재 가능.
- 배경은 기본 흰색이며 색상 또는 seamless 텍스처로 교체 가능.
- 타블릿 필압 지원. 패닝(Space+드래그)·줌(Ctrl+Space+드래그, 마우스 휠) 단축키. 지우개 토글은 `E`.
- 단색 원형 펜, 펜/지우개 별도 크기. 커서는 드로잉 영역(브러시 크기)을 표시하는 아이콘으로 변경.
- 전반적으로 Krita 사용 경험을 이식. 타일 컴포넌트는 곧 캔버스 스택(레이어 스택).
- 레이어 모드는 Normal/Multiply 2종, 알파(투명도) 채널 지원.
- 저장은 lossless webp, 압축률보다 빠른 저장 우선. 타일별 dirty flag로 저장 가속.
- 자동 저장/수동 저장 파일 분리: `title.infcanvas`, `.autosave-title.infcanvas`(dot 파일). zip 컨테이너이며 관련 MIME 규정 준수.
- 타일맵은 (0,0)에서 시작하는 정수 좌표. 뷰포트에 잡히는 타일만 로드, 안 보이는 타일은 언로드.
- 현재 열려 있는 파일은 컨테이너를 풀어 별도 영역에서 조작.
- Krita 스타일 컬러 피커(HSB + RGB 팔레트).
- 단일 사용자 모드, 로그인 없이 마지막 사용 도큐먼트를 자동 로드(최초 실행 시 "Canvas" 타이틀의 1타일짜리 빈 도큐먼트).

## 계획 수립 과정 (타임라인)

1. **저장소 상태 확인**: `sv create` 직후의 순수 SvelteKit(Svelte 5 runes, `adapter-static`) 스캐폴드 확인. 앱 코드 없음, 참고할 기존 패턴 없음 — 완전 신규 설계로 진행.
2. **질문 1 — 로컬 저장 방식**: "filesystem API"로 실제 파일을 어디에 둘지(OPFS 자동 관리 / 사용자가 고른 실제 폴더 / 하이브리드) 질의. → **OPFS 자동 관리(권장안)로 확정.** `navigator.storage.getDirectory()`를 사용해 권한 프롬프트 없이 자동으로 동작하도록 하여 "로그인 없이 마지막 도큐먼트 자동 로드" 요구사항을 그대로 만족시킨다.
3. **추가 요구사항 — seamless 타일 경계 스트로크**: 사용자가 "타일의 경계를 벗어난 펜 스트로크에서 seamless stroke를 유지합니다"를 명시적으로 추가. → 브러시 스탬프를 월드 좌표 기준으로 한 번만 보간하고, 각 스탬프를 걸치는 모든 타일에 정확히 512의 정수배 오프셋으로 동일 지오메트리를 그려 안티앨리어싱까지 일치시키는 방식으로 설계에 반영.
4. **작성 언어 방침**: "Planning, document, comment, UI language 모두 한국어로 작성" 요청. → 계획 문서, 코드 주석(필요한 경우), UI 문구 전부 한국어로 작성하는 것을 프로젝트 공통 원칙으로 확정.
5. **문서화 요청**: 계획 수립 과정과 결과를 `docs/tasks/2026-08-13 Infinite Canvas Milestone 1.md`에 남길 것을 요청받음 → 본 문서.
6. **플랜 리뷰 코멘트 1 — RxJS 사용**: "복잡한 이벤트 처리에는 RxJS 사용, 특히 펜 스트로크 관련 FSM에 적극 사용" 요청. → `rxjs`를 신규 의존성으로 추가. 펜 스트로크 생명주기(포인터다운→무브→업/캔슬)를 `exhaustMap` + `takeUntil` 패턴의 명시적 상태 머신으로 구현하고, 패닝/줌 제스처와 Space/Ctrl 홀드 기반 모드 전환(`mode$`)도 동일한 스타일로 통일하기로 설계 변경.
7. **플랜 리뷰 코멘트 2 — WebP 인코딩 전략 단순화**: "캔버스 네이티브를 먼저 사용. lossless 모드가 없다면 품질 우선 모드(극단적 값이 아닌 고주파 성분이 덜 깎이는 고품질 스위트스팟)로 저장, 역시 빠른 저장에 최적화" 요청. → 당초 계획했던 `@jsquash/webp`(WASM libwebp) 의존성을 완전히 제거. `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 1.0 })`이 실제로 무손실로 동작하는지 M1에서 실측 검증하고, 아니라면 quality를 1.0이 아닌 약 0.90~0.95 구간의 스위트스팟으로 고정하는 방식으로 변경. 이로써 M1의 WASM 번들링 리스크도 함께 제거됨.
8. **최종 승인**: 위 변경 사항을 반영한 계획을 재제출하여 승인받음.

## 확정된 아키텍처 (프로젝트 전체 공통)

### 신규 의존성

| 패키지   | 용도                                                                 |
| -------- | -------------------------------------------------------------------- |
| `dexie`  | 현재 열린 도큐먼트의 "언팩된" 작업 영역용 IndexedDB 래퍼             |
| `fflate` | `.infcanvas` 컨테이너 zip 읽기/쓰기 (STORE 모드로 무압축, 속도 우선) |
| `rxjs`   | 패닝/줌 제스처 및 펜 스트로크 FSM 등 복잡한 이벤트 처리              |

WASM 인코더(`@jsquash/webp` 등)와 캔버스 렌더링 프레임워크(Pixi/Konva 등)는 사용하지 않는다.

### 데이터 모델

```
Document { id, title, backgroundType: 'color'|'texture', backgroundColor, backgroundTextureId, layers: Layer[], createdAt, updatedAt }
Layer    { id, documentId, name, mode: 'normal'|'multiply', opacity: 0-1, visible, order }
Tile     { documentId, x, y (부호 있는 정수, 원점 (0,0)), dirty: boolean }   // sparse
TilePixels { documentId, x, y, layerId, pixels: 원본 RGBA8 512×512 ArrayBuffer }
```

타일 자체가 레이어 스택이며(레이어당 OffscreenCanvas + 캐시된 컴포지트), dirty 플래그는 타일 단위.

### 저장 구조 (2단계)

- **IndexedDB(Dexie)**: 현재 열린 도큐먼트의 언팩된 작업 영역. 원본 비압축 픽셀 버퍼 저장, 포인터업 시 즉시 flush.
- **OPFS**: 도큐먼트별 `.infcanvas` / `.autosave-title.infcanvas` zip blob 보관. 저장 시 dirty 타일만 webp로 재인코딩, 나머지는 캐시된 바이트 재사용.

### 컨테이너 포맷 (`.infcanvas` = zip)

- 첫 엔트리 `mimetype`(STORE, 무압축): `application/vnd.infcanvas+zip` — ODF/EPUB 방식의 매직 mimetype 관례.
- `manifest.json`, `tiles/{x}_{y}/{layerId}.webp`, `textures/{textureId}.webp`. 모든 엔트리 `level: 0`(무압축).

### WebP 인코딩 전략

1. `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 1.0 })`이 실제로 무손실인지 알려진 픽셀 패턴으로 인코딩→디코딩→바이트 비교로 실측 검증 (M1 스파이크).
2. 무손실 확인 시 그대로 사용, 아니면 quality를 0.90~0.95 스위트스팟으로 고정.
3. 인코딩은 Worker 풀에서 병렬 수행. 디코딩은 `createImageBitmap(blob)`.

### 드로잉 엔진 — 펜 스트로크 FSM (RxJS)

- `pointerdown$`(모드가 `drawing`일 때만) → `exhaustMap`으로 스트로크 스트림 오픈.
- 내부 스트림: `pointermove$` → `getCoalescedEvents()` 펼침 → 월드좌표+필압 매핑 → `takeUntil(pointerup$/pointercancel$/pointerleave$/모드이탈)`.
- `scan`으로 스탬프 간격 누적, `finalize()`에서 스트로크 커밋(dirty 마킹, Dexie flush).
- 타일 경계를 넘는 스탬프는 걸치는 모든 타일(최대 4개)에 512 정수배 오프셋으로 동일 지오메트리를 그려 seamless 유지.
- 패닝/줌도 동일한 `exhaustMap` + `takeUntil` 패턴, `mode$`(유휴/패닝/줌/드로잉)로 상호 게이팅.

### 렌더링/타일링

- 뷰포트 ÷ 512(+1타일 마진)로 로드 대상 결정, 범위 밖은 메모리에서 언로드(Dexie가 최신 상태 보장).
- 레이어를 아래→위로 Normal(`source-over`)/Multiply(`multiply`) + `globalAlpha`로 타일별 컴포지트 캐시 후 뷰포트에 pan/zoom 변환하여 그림.

### 모듈 구성

```
src/lib/canvas/{types,db,opfs,container,webpCodec(+worker),tileStore.svelte,document.svelte,renderer,brushEngine,input,color,exportServer}.ts
src/lib/components/{CanvasStage,Toolbar,LayerPanel,ColorPicker,DocumentSwitcher}.svelte
src/routes/+page.svelte
```

## M1 스파이크 결과 — WebP 무손실 실측

`src/lib/canvas/webpCodec.svelte.spec.ts`에서 Vitest 브라우저 프로젝트(실제 Chromium, headless)로
실측한 결과: **이 환경(Chrome for Testing 151.x)에서 `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 1 })`은 실제로 무손실이다.** 체크보드+대각 그라디언트의 완전 불투명(alpha=255) 64×64 고주파 패턴을 인코딩→`createImageBitmap`으로 디코딩→`getImageData`로 원본과 바이트 단위 비교했을 때 완전히 일치했다.

- alpha=255 픽셀만 사용한 이유: Canvas2D의 알파 프리멀티플라이 반올림이라는 별개 변수를 배제하고 WebP 인코더 자체의 무손실 여부만 순수하게 확인하기 위함.
- WebP의 무손실(VP8L) 모드는 RGBA를 하나의 비트스트림으로 함께 인코딩하므로, 색상 채널이 무손실이면 알파 채널도 함께 무손실로 처리된다 — 별도의 알파 전용 검증은 생략했다.
- `webpCodec.ts`의 `resolveTileWebpQuality()`는 이 판정을 하드코딩하지 않고 런타임에 동일한 방식으로 실측/메모이즈한다 — 다른 브라우저 엔진에서 결과가 다르더라도 자동으로 올바른 quality(무손실 시 1, 아니면 `HIGH_QUALITY_SWEET_SPOT`=0.92)로 폴백하기 위함.

결과적으로 원래 요구사항인 "lossless webp"를 WASM 의존성 없이, 사용자가 지시한 "캔버스 네이티브 우선" 방침 그대로 충족했다.

## Milestone 1 범위 (기반 작업)

- 의존성 설치(`dexie`, `fflate`, `rxjs`).
- 공통 타입(`types.ts`), Dexie 스키마(`db.ts`).
- OPFS 읽기/쓰기/목록 헬퍼(`opfs.ts`).
- 컨테이너 pack/unpack — mimetype 엔트리, manifest, zip STORE 모드(`container.ts`).
- WebP 인코딩 전략 스파이크 및 확정(`webpCodec.ts`) — 무손실 여부 실측.
- 최초 실행 시 "Canvas" 도큐먼트(빈 타일 1개) 자동 생성, 마지막 사용 도큐먼트 자동 로드 부트스트랩.

## M1 완료 상태

`src/lib/canvas/{types,db,opfs,container,webpCodec,bootstrap}.ts`로 구현 완료. 유닛/브라우저 테스트(`container.spec.ts`, `webpCodec.svelte.spec.ts`, `bootstrap.svelte.spec.ts`) 10개 전부 통과, `bun run check`(svelte-check) 0 에러, `bun run lint` 통과, `bun run build` 성공을 확인했다.

빌드 과정에서 스캐폴드 자체의 사전 이슈를 하나 발견해 함께 고쳤다: `adapter-static`은 기본적으로 모든 라우트가 프리렌더 가능해야 하는데, 스캐폴드에는 이를 지정하는 파일이 없어 `bun run build`가 실패했다(내 M1 변경과 무관하게 처음부터 실패하는 상태였음). 이 앱은 서버 라우트가 없는 브라우저 전용 SPA이므로 `src/routes/+layout.ts`에 `export const prerender = true`를 추가해 정적 셸을 프리렌더링하고 클라이언트에서 하이드레이션하도록 했다.

## 이후 마일스톤 (요약)

M2 타일 렌더링/뷰포트 · M3 드로잉 엔진 · M4 레이어 · M5 영속성(저장/자동저장) · M6 컬러 피커 · M7 도큐먼트 관리 · M8 내보내기(fetch/다운로드).

명시적으로 범위 밖: 실행취소/다시실행(undo/redo) — 요청에 없어 제외, 후속 과제로 제안.

## 검증 계획

- Vitest(브라우저 프로젝트): HSB↔RGB 변환, 타일 좌표 연산, 컨테이너 라운드트립, dirty 플래그 전이.
- Playwright e2e: 도큐먼트 생성 → 타일 경계를 넘는 스트로크 → 리로드 → 픽셀 영속 및 경계 이음매 연속성 확인.
- M3/M4/M5 체크포인트에서 WSL→Windows Chrome CDP 방식 수동 브라우저 검증(개발 서버는 사용자가 실행).
