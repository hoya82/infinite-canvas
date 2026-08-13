# Infinite Canvas — Milestone 8 (내보내기)

작성일: 2026-08-13
상태: 구현 완료(자동 검증 완료), 브라우저 수동 검증은 이후 체크포인트에서 진행

## 개요

계획했던 8개 마일스톤의 마지막이다. 서버로 내보내는 fetch 호출을 "준비"해두고(백엔드는 이 앱에 포함하지 않는다 — `adapter-static`이라 서버가 없다), OPFS에만 있는 `.infcanvas`를 실제 로컬 디스크로 내려받는 액션을 추가한다.

## 구현 내용

- `exportServer.ts`
  - `exportDocumentToServer(documentId, endpointUrl)` — 내보내기 전에 항상 `saveDocument(id, 'manual')`로 최신 상태를 한 번 저장한 뒤, 완성된 컨테이너를 `Content-Type: application/vnd.infcanvas+zip`으로 지정한 URL에 POST한다. 실패/성공 처리는 호출부(Toolbar) 책임으로 남기고, 이 함수는 `fetch`의 `Response`를 그대로 반환한다.
  - `downloadDocument(documentId)` — 같은 방식으로 최신 컨테이너를 준비한 뒤, **가능하면** `showSaveFilePicker`로 저장 위치를 직접 고르게 하고, 지원하지 않는 환경(또는 사용자가 취소한 경우 이외의 실패)에서는 `<a download>` 방식으로 자동 대체한다.
- `Toolbar.svelte`에 다운로드 버튼과, 엔드포인트 URL을 입력해 서버로 보내는 작은 팝오버(전송 중/완료/실패 상태 표시)를 추가했다.
- `src/app.d.ts`에 `showSaveFilePicker`의 최소 타입을 직접 선언했다 — `FileSystemFileHandle` 자체는 이미 TS DOM lib에 있지만(M1부터 `opfs.ts`에서 사용 중), `Window.showSaveFilePicker`는 아직 lib에 없어서 타입 체크가 실패했다.

## 실측으로 확인한 것 — 헤드리스 Chromium에도 `showSaveFilePicker`가 존재한다

`downloadDocument`의 두 경로(네이티브 피커 vs `<a download>` 폴백)를 테스트하려고 "헤드리스 환경엔 `showSaveFilePicker`가 없을 것"이라고 가정한 assertion을 먼저 넣었는데, 실제로 실행해보니 **이 Chrome for Testing 빌드는 헤드리스에서도 `window.showSaveFilePicker`가 함수로 존재**했다(다만 실제로 호출하면 렌더링할 수 없는 네이티브 대화상자를 기다리며 멈춘다). 그래서 테스트에서는 실제 환경에 기대는 대신 두 경우 모두 `window.showSaveFilePicker`를 직접 스텁으로 갈아끼워 각 분기를 확실하게 검증했다 — 여기서도 "환경이 이럴 것"이라는 가정 대신 실측 후 코드를 맞췄다.

## 검증

- `exportServer.svelte.spec.ts`: `fetch`를 스파이해 서버 전송이 올바른 URL/메서드/Content-Type/본문으로 이루어지는지와 전송 전 저장이 실제로 일어나는지(dirty가 지워짐), `showSaveFilePicker`가 없을 때의 `<a download>` 폴백, `showSaveFilePicker`가 있을 때 그 경로로 실제로 파일을 쓰고 `<a>` 폴백은 타지 않는지 — 3개 전부 통과.
- 전체 스위트 49개(M1~M8 누적) 통과, `svelte-check` 0 에러, lint 통과, 빌드 성공.
- 브라우저 수동 검증은 이후 체크포인트에서 M2~M7과 함께 진행한다.

## 계획했던 8개 마일스톤 완료

M1(기반) ~ M8(내보내기)까지 자동 검증(유닛/통합 테스트, 타입체크, lint, 빌드) 기준으로는 전부 구현이 끝났다. 아직 실제 브라우저에서 사람이 직접 그려보고 확인하는 수동 검증은 진행하지 못했다 — 개발 서버 실행이 필요해 사용자에게 요청해 둔 상태다. 실행취소/다시실행(undo/redo)은 원 요구사항에 없어 처음부터 범위 밖으로 뒀고, 여전히 후속 과제로 유효하다.
