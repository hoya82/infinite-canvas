# Infinite Canvas — Milestone 10 (액정 태블릿 롱프레스 컨텍스트 메뉴 버그)

작성일: 2026-08-13
상태: 적용 완료

## 문제

액정 태블릿 사용자가 펜을 거의 움직이지 않고 오래 눌러(정밀 작업을 위한 느리고 짧은 스트로크) 그릴 때 컨텍스트 메뉴가 뜬다. 빠르게 스트로크하면 재현되지 않는다 — 이는 OS/브라우저가 "포인터가 오래 눌린 채 거의 움직이지 않음"을 롱프레스 제스처로 해석해 `contextmenu` 이벤트를 합성해 띄우기 때문이다(Windows의 펜 "누르고 있으면 마우스 오른쪽 버튼" 동작과 동일 계열). 단, 펜의 사이드 스위치(배럴 버튼)를 눌러 여는 컨텍스트 메뉴는 정상 기능이므로 그것까지 막으면 안 된다.

## 구분 방법

두 경우 모두 최종적으로 같은 `contextmenu` DOM 이벤트가 발생하지만, `event.button` 값이 다르다:

- **롱프레스로 합성된 경우**: 실제로는 어떤 버튼도 눌리지 않았으므로 `button === 0`.
- **진짜 보조 버튼이 눌린 경우**(펜 사이드 스위치, 마우스 우클릭): `button === 2`(MouseEvent 스펙의 "secondary button").

`button === 0`일 때만 `preventDefault()`로 막고, `button === 2`는 그대로 통과시키면 요구사항을 정확히 만족한다.

## 구현

`input.ts`의 `createCanvasInput` 안에 캔버스의 `contextmenu` 이벤트를 구독해 `button === 0`인 것만 걸러 `preventDefault()`하는 순수 부작용 구독을 추가했다. 그리기 상태(state)에 영향을 주지 않는 순수한 브라우저 기본 동작 억제라서, 다른 스트림들처럼 `CanvasInput`으로 반환해 `CanvasStage`가 구독/해제를 관리하게 하지 않고 `createCanvasInput` 내부에서 자체적으로 구독을 끝냈다(반응할 앱 상태가 없어 외부로 노출할 이유가 없다).

## 검증

- `input.svelte.spec.ts`(실제 DOM에 캔버스를 만들어 `createCanvasInput`을 호출하는 브라우저 테스트): `button: 0`으로 합성한 `contextmenu`는 `defaultPrevented === true`(막힘), `button: 2`로 합성한 것은 `defaultPrevented === false`(통과)임을 직접 확인 — 2개 전부 통과.
- 전체 스위트 51개(누적) 통과, `svelte-check` 0 에러, lint 통과, 빌드 성공.
- 같은 WSL→Chrome CDP 세션에서, 실제로 돌아가고 있는 앱(테스트용 새 인스턴스가 아니라 `CanvasStage`가 이미 등록해 둔 실제 리스너)을 대상으로 `button: 0`/`button: 2` 두 이벤트를 합성해 쏴 봤고, 결과가 유닛 테스트와 동일하게 `{ longPressBlocked: true, sideButtonBlocked: false }`로 나옴을 확인했다 — 실제 배포 코드 경로까지 확인한 것이다.
- **한계**: 이 환경(WSL + 원격 Windows Chrome)에는 실제 펜 태블릿 하드웨어가 없어, "실제 액정 태블릿에서 느린 스트로크 중 롱프레스가 진짜로 `button: 0`짜리 `contextmenu`를 합성해 낸다"는 전제 자체는 코드 테스트로 검증하지 못했다 — 이는 문서화된 브라우저/OS 동작에 근거한 것이고, 반대쪽(실제 마우스 우클릭이 `button: 2`로 와서 안 막힌다)은 Playwright로 진짜 마우스 우클릭을 재현해 확인했다. 실제 펜 하드웨어에서의 최종 확인은 사용자가 직접 해줘야 한다.
