# Infinite Canvas — Milestone 5 (영속성)

작성일: 2026-08-13
상태: 구현 완료(자동 검증 완료), 브라우저 수동 검증은 이후 체크포인트에서 M2~M4와 함께 진행

## 개요

지금까지의 편집은 전부 Dexie(IndexedDB) 작업 영역에만 있었고, 새로고침하면 OPFS에 저장된 마지막 상태로 되돌아갔다(M1의 부트스트랩이 매번 OPFS에서 하이드레이션하기 때문). 이 마일스톤에서 실제로 편집 내용을 `.infcanvas` 컨테이너로 다시 묶어 OPFS에 쓰는 저장 경로를 완성한다: 수동 저장(`title.infcanvas`)과 자동 저장(`.autosave-title.infcanvas`)을 분리하고, dirty 타일만 lossless webp로 재인코딩해 저장 속도를 최적화한다.

## 구현 내용

- `types.ts`의 `TilePixelsRecord`에 `webpCache: ArrayBuffer | null` 필드를 추가했다 — 현재 `pixels`를 마지막으로 인코딩한 결과의 캐시다. 브러시로 그릴 때(`brushEngine.ts`)마다 `null`로 무효화되고, 컨테이너 하이드레이션(`bootstrap.ts`) 시에는 방금 읽은 webp 바이트 자체를 캐시로 채운다.
- `webpCodec.worker.ts` + `webpWorkerPool.ts` — dirty 타일 인코딩을 `navigator.hardwareConcurrency` 기반(최대 4개)의 워커 풀에 병렬로 분산한다. `pixels` ArrayBuffer는 워커로 transfer(zero-copy)되므로 호출부에서 미리 복사본을 넘긴다. Vite의 `?worker` 임포트를 사용했다.
- `persistence.ts` — `saveDocument(documentId, 'manual' | 'autosave')`가 두 저장 경로를 공유한다: 1) dirty 타일 × 레이어 조합만 워커 풀로 재인코딩해 `webpCache` 채움 2) 모든 타일의 `webpCache`를 모아 컨테이너 구성(dirty가 아니었던 타일은 기존 캐시를 그대로 재사용) 3) `kind`에 따라 다른 파일명(`opfs.manualSaveFileName`/`autosaveFileName`)으로 기록 4) 방금 처리한 dirty 타일들의 `dirty`를 false로 되돌림. `startAutosaveLoop(getDocumentId, intervalMs)`는 dirty 타일이 있을 때만 저장하고, `setInterval`이 아니라 "저장이 끝난 뒤 다음 타이머를 예약"하는 방식이라 저장이 오래 걸려도 겹쳐 실행되지 않는다.
- `+page.svelte` — `Ctrl/Cmd+S`로 수동 저장(브라우저 기본 "페이지 저장" 동작은 막음), 마운트 시 30초 간격 자동 저장 루프 시작, 저장 상태를 잠깐 보여주는 작은 인디케이터.

## 발견하고 고친 버그 — boolean은 IndexedDB 인덱스 키가 될 수 없다

M1에서 `tiles` 테이블에 `[documentId+dirty]` 복합 인덱스를 만들어 두었는데(`dirty: boolean`), 이 마일스톤에서 실제로 그 인덱스를 조회하는 코드(자동 저장의 "dirty 타일이 있는지" 확인)를 작성하면서 실행해보니 **`DataError: ... The parameter is not a valid key`**가 발생했다. IndexedDB의 유효한 키 타입은 문자열/숫자/날짜/바이너리/배열뿐이고 boolean은 포함되지 않는다는 스펙을 미처 챙기지 못한 채 인덱스를 설계했던 것이다.

- `db.ts`에서 `[documentId+dirty]` 복합 인덱스를 제거하고, `tiles: 'id, documentId'`로 되돌렸다.
- dirty 조회는 `db.tiles.where('documentId').equals(id).filter((t) => t.dirty)`로 바꿨다 — `documentId` 인덱스로 먼저 좁힌 뒤 dirty는 JS에서 거른다(도큐먼트당 타일 수가 실질적으로 크지 않아 성능 손실은 무시할 만하다).
- `dexieBooleanIndex.svelte.spec.ts`에 회귀 테스트를 남겼다: 깨지는 스키마(임시 Dexie 인스턴스)로 실제 DataError가 재현됨을 확인하는 테스트 하나, 고친 방식이 정상 동작함을 확인하는 테스트 하나.

## 검증

- `persistence.svelte.spec.ts`(실제 IndexedDB + 실제 Worker를 쓰는 브라우저 테스트):
  - 수동 저장이 dirty 타일만 재인코딩해 `title.infcanvas`에 기록하고 dirty를 지우는지, 컨테이너를 다시 풀었을 때 manifest/타일이 정확한지.
  - **워커 호출 횟수를 스파이로 세어**, 자동 저장이 변경 없는 상태에서는 재인코딩을 전혀 하지 않고 캐시를 재사용함을 직접 증명(단순히 "결과가 같다"가 아니라 "인코딩 함수가 호출되지 않았다"를 확인).
  - `startAutosaveLoop`이 dirty가 있을 때 실제로 자동 저장 파일을 만들고, 반환된 정지 함수로 멈출 수 있는지.
- `dexieBooleanIndex.svelte.spec.ts`: 위에서 설명한 회귀 테스트 2개.
- 전체 스위트 34개(M1~M5 누적) 통과, `svelte-check` 0 에러, lint 통과, 빌드 성공.
- 브라우저 수동 검증(그림을 그리고 새로고침해도 남아있는지, 저장 인디케이터, 실제 자동저장 주기)은 M2~M4와 함께 다음 체크포인트에서 진행한다.

## 다음

M6(컬러 피커)에서 지금은 `toolState.color`에 고정돼 있는 전경색을 Krita 스타일 HSB+RGB 피커로 실제로 바꿀 수 있게 한다.
