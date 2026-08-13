# Infinite Canvas — Milestone 4 (레이어)

작성일: 2026-08-13
상태: 구현 완료(자동 검증 완료), 브라우저 수동 검증은 이후 체크포인트에서 M2/M3와 함께 진행

## 개요

레이어를 실제로 추가/삭제/이름변경/순서변경/블렌드모드/알파를 조작할 수 있는 UI를 붙인다. 컴포지팅 자체(Normal/Multiply + 알파)는 이미 M2의 `renderer.ts`가 처리하고 있었으므로, 이 마일스톤은 "레이어 스택을 조작하는 모델 계층 + 그 조작을 위한 패널 UI"에 집중했다.

## 구현 내용

- `document.svelte.ts`에 레이어 CRUD를 추가했다: `addLayer`(스택 맨 위에 추가하고 자동으로 활성 레이어로 선택), `removeLayer`(최소 1개는 항상 유지, 그 레이어의 `tilePixels`도 Dexie 복합 인덱스 `[documentId+layerId]`로 함께 정리, 활성 레이어를 지웠으면 스택 최상단으로 활성 레이어 이동), `renameLayer`(공백 트림, 빈 이름 무시), `setLayerMode`, `setLayerOpacity`(0~1로 clamp), `setLayerVisible`, `moveLayer(id, 'up'|'down')`(인접 레이어와 `order` 값을 맞바꾸는 방식 — 부동소수점 간격 관리 없이 항상 정합성이 유지된다).
- `LayerPanel.svelte` — 우측 고정폭 사이드 패널. 스택 상단이 목록 위로 오도록 표시(`orderedLayers`를 뒤집어서 렌더링). 각 행: 표시/숨김 토글(eye 아이콘), 더블클릭으로 이름 인라인 편집, Normal/Multiply 드롭다운, 알파 슬라이더(%), 위/아래 이동, 삭제. 활성 레이어는 강조 표시되고 클릭으로 전환된다.
- `+page.svelte`를 `CanvasStage`(가변 폭) + `LayerPanel`(고정 폭 260px) 가로 레이아웃으로 재구성했다.
- 아이콘은 M2에서 정한 정책대로 `lucide-svelte/icons/*` 딥 임포트만 사용(eye, eye-off, plus, trash-2, chevron-up, chevron-down).

## 기존 아키텍처와의 연결 확인

레이어 추가/삭제가 이미 메모리에 로드된 타일들과 잘 맞물리는지 M2/M3 설계를 다시 검토했다:

- **레이어 추가**: 이미 로드된 타일의 `layerCanvases`에는 새 레이어의 캔버스가 없지만, 렌더러는 `layerCanvases.get(layer.id)`가 없으면 조용히 건너뛰므로 문제없다(새 레이어는 어차피 빈 내용이 맞다). 사용자가 그 레이어에 실제로 그리기 시작하면 `tileStore.getForDrawing`이 이미 로드된 타일에 그 레이어의 빈 캔버스를 지연 생성해 채워 넣는다 — 별도 처리가 필요 없었다.
- **레이어 삭제**: `renderer.ts`가 순회하는 레이어 목록은 항상 `documentState.orderedLayers`(삭제 후 갱신됨)에서 나오므로, 메모리에 남아있는 삭제된 레이어의 캔버스는 그냥 그려지지 않는다. Dexie `tilePixels`만 명시적으로 정리해 데이터가 쌓이지 않게 했다.

두 경우 모두 코드를 추가로 고칠 필요 없이 기존 설계가 이미 올바르게 대응했다 — M2/M3에서 "타일이 레이어 목록 변화에 반응하는 방식"을 미리 잘 분리해둔 덕분이다.

## 검증

- `document.svelte.spec.ts`(Dexie를 실제로 쓰는 브라우저 테스트): addLayer, removeLayer의 최소-1-유지 규칙, 활성 레이어 삭제 시 대체 동작, opacity clamp, mode/rename/visible이 상태와 Dexie에 함께 반영되는지, moveLayer의 인접 스왑과 경계에서의 no-op — 6개 전부 통과.
- 전체 스위트 29개(M1~M4 누적) 통과, `svelte-check` 0 에러, lint 통과, 빌드 성공(3.67초 — lucide 아이콘 6개를 딥 임포트로 추가했는데도 M2에서 확인한 것처럼 빌드 시간에 영향이 없음을 재확인).
- 브라우저 수동 검증(레이어를 여러 장 만들어 Normal/Multiply + 알파 조합으로 실제로 그려보기)은 M2/M3와 함께 다음 체크포인트에서 진행한다.

## 다음

M5(영속성)에서 지금까지의 모든 편집이 실제로 `.infcanvas` 파일(OPFS)에 저장되고, 새로고침 후에도 살아남는지를 완성한다.
