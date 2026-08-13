# Infinite Canvas

**서버 없이, 브라우저 하나로 완결되는 무한 캔버스 드로잉 앱.**

512×512 타일이 사방으로 무한히 확장되는 캔버스 위에서, Krita 같은 손맛으로 그림을 그립니다. 그림도, 도큐먼트 목록도, 자동 저장본도 전부 브라우저 안(OPFS + IndexedDB)에만 있습니다 — 백엔드도, 로그인도, 네트워크도 필요 없습니다.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![SvelteKit](https://img.shields.io/badge/built%20with-SvelteKit%20%2B%20Svelte%205-ff3e00.svg)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

## 목차

- [왜 서버가 없나요](#왜-서버가-없나요)
- [주요 특징](#주요-특징)
- [단축키](#단축키)
- [설치 및 실행](#설치-및-실행)
- [저장 파일 (.infcanvas)](#저장-파일-infcanvas)
- [서버로 내보내기 (선택 사항)](#서버로-내보내기-선택-사항)
- [기술 스택](#기술-스택)
- [알려진 제한 사항](#알려진-제한-사항)
- [기여](#기여)
- [크레디트](#크레디트)
- [라이선스](#라이선스)

## 왜 서버가 없나요

대부분의 드로잉/화이트보드 웹앱은 그림을 서버에 올려야 저장이 되고, 서버가 죽으면 작업도 멈춥니다. Infinite Canvas는 반대로 설계했습니다:

- **모든 데이터는 브라우저 안에만 존재합니다.** 도큐먼트 컨테이너(`.infcanvas`)는 [OPFS](https://developer.mozilla.org/ko/docs/Web/API/File_System_API/Origin_private_file_system)에, 지금 편집 중인 작업 영역은 IndexedDB(Dexie)에 저장됩니다. 권한 팝업도, 로그인 화면도 없이 브라우저를 켜면 마지막으로 작업하던 도큐먼트가 바로 열립니다.
- **오프라인에서도 100% 동작합니다.** 네트워크가 끊겨도 그리기, 저장, 도큐먼트 전환 전부 그대로 됩니다.
- **서버는 완전히 선택 사항입니다.** 그림을 어딘가에 백업하거나 공유하고 싶다면, 로컬 파일로 내려받거나(다운로드) 원하는 자신만의 서버로 전송할 수 있습니다 — 이 앱이 특정 백엔드에 종속되지 않도록, 그 서버 스펙은 [docs/api.md](docs/api.md)에 별도로 문서화되어 있습니다.

## 주요 특징

**캔버스**

- 512×512 타일이 사방으로 무한 확장되는 캔버스. 타일은 sparse해서 그린 곳만 실제로 존재합니다(섬처럼 떨어진 곳에 그려도 됩니다).
- 뷰포트에 보이는 타일만 메모리에 올리고 벗어나면 내려서, 아무리 넓게 그려도 메모리를 낭비하지 않습니다.

**드로잉**

- 단색 원형 펜 + 지우개, 태블릿 필압 지원(펜 종류일 때만 필압을 반영하고 마우스는 항상 최대 굵기).
- 펜/지우개가 서로 독립된 굵기 값을 가집니다.
- 타일 경계를 가로지르는 스트로크도 이음매 없이 이어집니다.
- 액정 태블릿에서 느리고 정밀한 스트로크 중 롱프레스로 컨텍스트 메뉴가 뜨는 문제를 막았습니다(펜 사이드 스위치 메뉴는 그대로 동작).

**레이어**

- 레이어를 추가/삭제/이름변경/순서변경할 수 있고, Normal·Multiply 블렌드 모드와 알파(투명도)를 지원합니다.

**색상**

- Krita 스타일 컬러 피커 — Hue 슬라이더 + Saturation/Value 사각형(HSB), RGB 슬라이더, hex 입력을 모두 지원합니다.

**저장**

- 가능한 경우 진짜 무손실 WebP로 저장하고(브라우저가 지원하지 않으면 고품질 손실 모드로 자동 대체), 타일별 dirty 플래그로 바뀐 타일만 재인코딩해 저장 속도를 최적화합니다. 인코딩은 Web Worker 풀에서 병렬로 처리됩니다.
- 수동 저장(`title.infcanvas`)과 자동 저장(`.autosave-title.infcanvas`)이 서로 다른 파일로 분리되어 있어, 자동 저장이 수동 저장 시점을 덮어쓰지 않습니다.

**도큐먼트**

- 여러 도큐먼트를 만들고 목록에서 전환/이름변경/삭제할 수 있습니다.
- 배경은 단색 또는 직접 업로드한 seamless 텍스처 이미지로 바꿀 수 있습니다.

## 단축키

Krita 사용자에게 익숙한 조작을 그대로 옮겼습니다.

| 동작             | 단축키                                          |
| ---------------- | ----------------------------------------------- |
| 패닝             | `Space` 누른 채 드래그                          |
| 확대/축소        | `Ctrl` + `Space` 누른 채 드래그, 또는 마우스 휠 |
| 펜 ⇄ 지우개 전환 | `E`                                             |
| 수동 저장        | `Ctrl`/`Cmd` + `S`                              |

패닝 중에는 커서가 손(grab/grabbing) 모양으로, `Ctrl+Space`를 누르고 있는 동안은 돋보기 모양으로 바뀝니다.

## 설치 및 실행

[Bun](https://bun.sh)을 기준으로 합니다(다른 Node 패키지 매니저도 대부분 동작합니다).

```bash
# 저장소를 내려받은 뒤 그 디렉터리에서
bun install
bun run dev
```

브라우저에서 개발 서버 주소(기본 `http://localhost:5173`)를 열면 됩니다. 처음 실행하면 "Canvas"라는 이름의 빈 도큐먼트가 자동으로 만들어집니다.

> **브라우저 요구 사항**: OPFS와 File System Access API를 쓰기 때문에 Chromium 계열 브라우저(Chrome, Edge 등)가 필요합니다.

배포용 정적 빌드:

```bash
bun run build
bun run preview
```

`adapter-static`으로 빌드되므로, 결과물(`build/`)은 서버 사이드 런타임 없이 아무 정적 호스팅에나 올리면 됩니다.

## 저장 파일 (.infcanvas)

`.infcanvas`는 zip 컨테이너입니다. mimetype 매직 엔트리, `manifest.json`, 타일/텍스처별 webp 이미지로 구성됩니다. 파일 포맷의 정확한 스키마는 [docs/api.md](docs/api.md)에 문서화되어 있습니다(원래는 서버 구현자를 위한 문서지만, 포맷 자체를 이해하는 데도 유용합니다).

## 서버로 내보내기 (선택 사항)

툴바의 내보내기 버튼에서 원하는 서버 URL을 입력하면, 현재 도큐먼트의 `.infcanvas` 컨테이너를 그 주소로 `POST`합니다. 이 앱에는 그 요청을 받는 서버가 포함되어 있지 않습니다 — 필요하다면 직접(또는 AI 에이전트를 시켜) 구현할 수 있도록 요청/응답 형식과 컨테이너 포맷을 [docs/api.md](docs/api.md)에 상세히 정리해 뒀습니다.

## 기술 스택

- [SvelteKit](https://svelte.dev/docs/kit) + Svelte 5(runes), TypeScript
- [RxJS](https://rxjs.dev) — 패닝/줌/펜 스트로크 같은 복잡한 입력 상태머신을 명시적인 스트림으로 구성
- [Dexie](https://dexie.org)(IndexedDB), [fflate](https://github.com/101arrowz/fflate)(zip)
- [lucide-svelte](https://lucide.dev/guide/svelte) 아이콘
- Vitest(유닛 + 실브라우저 테스트), Playwright

## 알려진 제한 사항

- 실행취소/다시실행(undo/redo)은 아직 없습니다.
- 컬러 피커 팝업은 바깥을 클릭해도 닫히지 않습니다(스워치를 다시 클릭해서 닫아야 합니다).

## 기여

이슈와 PR을 환영합니다. 작업 전 마일스톤/의사결정 기록은 `docs/tasks/`에서 시간순으로 확인할 수 있습니다.

## 크레디트

- [Hoya Kim](mailto:hoya@mychar.info) — 제작
- Claude (Anthropic) — AI 페어 프로그래머로 대부분의 구현에 참여

## 라이선스

[MIT](LICENSE)
