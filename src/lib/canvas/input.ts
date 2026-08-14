/**
 * DOM 이벤트를 RxJS 스트림으로 변환하는 단일 진입점.
 *
 * Space/Ctrl 홀드 상태로부터 "지금 포인터다운을 하면 무엇을 하게 되는가"를 나타내는
 * baseMode$를 파생시키고, 패닝/줌 드래그 제스처는 스트로크(FSM, M3의 brushEngine.ts)와
 * 동일한 `exhaustMap` + `takeUntil` 패턴으로 구현한다. 이렇게 하면 입력 처리 전체가
 * 하나의 일관된 스타일을 갖고, pointercancel·모드 중간 전환 같은 경쟁조건을
 * 별도의 불리언 플래그 없이 스트림 조합만으로 안전하게 처리할 수 있다.
 */
import { combineLatest, fromEvent, merge, type Observable } from 'rxjs';
import {
	distinctUntilChanged,
	exhaustMap,
	filter,
	map,
	share,
	shareReplay,
	startWith,
	takeUntil,
	tap,
	withLatestFrom
} from 'rxjs/operators';

/**
 * Space를 누른 상태에서 포인터다운을 하면 pan, Ctrl까지 누르고 있으면 zoom.
 * Space 없이 Ctrl만 누르고 있으면 eyedropper(스포이드), 아무것도 안 누르면 draw(그리기 도구가 처리).
 * Space와 Ctrl 각각이 "어느 클러스터인가"(pan-계열 vs draw-계열)와 "그 안의 보조 동작"(zoom vs
 * eyedropper)을 독립적으로 결정하는 구조라 두 조합 모두 하나의 파생 스트림으로 표현된다.
 */
export type BaseMode = 'draw' | 'pan' | 'zoom' | 'eyedropper';

/**
 * 커서 모양. Space를 누르는 순간 grab(잡은 손 모양이 아니라 열린 손), 실제로 드래그하는 동안은
 * grabbing(쥔 손)으로 바뀌고, Space를 떼면 즉시 원래 도구(draw)로 돌아온다. Ctrl+Space가 눌려
 * 있으면(드래그 여부와 무관하게) zoom을 유지한다. Space 없이 Ctrl만 누르면 eyedropper를 유지한다.
 * 마우스 휠 줌은 이 상태에 영향을 주지 않는다.
 */
export type CursorMode = 'draw' | 'grab' | 'grabbing' | 'zoom' | 'eyedropper';

export interface PanDelta {
	dxScreen: number;
	dyScreen: number;
}

export interface ZoomGesture {
	factor: number;
	anchorScreenX: number;
	anchorScreenY: number;
}

export interface CanvasInput {
	baseMode$: Observable<BaseMode>;
	cursorMode$: Observable<CursorMode>;
	/** 캔버스 위 pointerdown. 그리기 도구(M3)도 이 스트림을 그대로 재사용한다 */
	pointerDown$: Observable<PointerEvent>;
	pointerMove$: Observable<PointerEvent>;
	pointerUp$: Observable<PointerEvent>;
	pointerCancel$: Observable<PointerEvent>;
	pointerEnter$: Observable<PointerEvent>;
	pointerLeave$: Observable<PointerEvent>;
	pan$: Observable<PanDelta>;
	zoomDrag$: Observable<ZoomGesture>;
	wheelZoom$: Observable<ZoomGesture>;
	/** E 키 — 펜/지우개 토글 */
	toggleTool$: Observable<void>;
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

function spaceHeld$(): Observable<boolean> {
	const down$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(
		filter((e) => e.code === 'Space' && !e.repeat && !isEditableTarget(e.target)),
		tap((e) => e.preventDefault()),
		map(() => true)
	);
	const up$ = fromEvent<KeyboardEvent>(window, 'keyup').pipe(
		filter((e) => e.code === 'Space'),
		map(() => false)
	);
	// 창 포커스를 잃으면(Alt+Tab 등) 눌림 상태가 그대로 고정되는 것을 방지
	const blur$ = fromEvent(window, 'blur').pipe(map(() => false));

	return merge(down$, up$, blur$).pipe(startWith(false), distinctUntilChanged());
}

/** keydown/keyup 어떤 이벤트든 그 시점의 Ctrl 눌림 상태를 정확히 담고 있으므로 그대로 매핑한다 */
function ctrlHeld$(): Observable<boolean> {
	return merge(
		fromEvent<KeyboardEvent>(window, 'keydown'),
		fromEvent<KeyboardEvent>(window, 'keyup')
	).pipe(
		map((e) => e.ctrlKey),
		startWith(false),
		distinctUntilChanged()
	);
}

function toCanvasLocal(
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number
): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	return { x: clientX - rect.left, y: clientY - rect.top };
}

export function createCanvasInput(canvas: HTMLCanvasElement): CanvasInput {
	const baseMode$: Observable<BaseMode> = combineLatest([spaceHeld$(), ctrlHeld$()]).pipe(
		map(([space, ctrl]): BaseMode => {
			if (space) return ctrl ? 'zoom' : 'pan';
			return ctrl ? 'eyedropper' : 'draw';
		}),
		distinctUntilChanged(),
		shareReplay({ bufferSize: 1, refCount: true })
	);

	const pointerDown$ = fromEvent<PointerEvent>(canvas, 'pointerdown').pipe(share());
	const pointerMove$ = fromEvent<PointerEvent>(canvas, 'pointermove');
	const pointerUp$ = fromEvent<PointerEvent>(canvas, 'pointerup');
	const pointerCancel$ = fromEvent<PointerEvent>(canvas, 'pointercancel');
	const pointerEnter$ = fromEvent<PointerEvent>(canvas, 'pointerenter');
	const pointerLeave$ = fromEvent<PointerEvent>(canvas, 'pointerleave');

	const toggleTool$ = fromEvent<KeyboardEvent>(window, 'keydown').pipe(
		filter((e) => e.code === 'KeyE' && !e.repeat && !isEditableTarget(e.target)),
		map(() => undefined)
	);

	// 액정 태블릿 등에서 펜을 거의 움직이지 않고 오래 누르고 있으면(정밀 작업을 위한 느린 짧은
	// 스트로크) OS/브라우저가 이를 롱프레스로 해석해 contextmenu 이벤트를 합성해 띄운다. 이렇게
	// 합성된 이벤트는 실제로는 어떤 버튼도 눌리지 않았기 때문에 button이 0으로 온다 — 반면 펜
	// 사이드 스위치나 마우스 우클릭처럼 진짜 보조 버튼이 눌려서 뜨는 contextmenu는 button이 2다.
	// 이 차이로 롱프레스로 합성된 것만 골라 막고, 사이드 스위치 컨텍스트 메뉴는 그대로 둔다.
	// 그리기 상태(state)에 영향을 주지 않는 순수한 브라우저 기본 동작 억제라 별도 구독 없이
	// 여기서 바로 처리한다.
	fromEvent<MouseEvent>(canvas, 'contextmenu')
		.pipe(filter((e) => e.button === 0))
		.subscribe((e) => e.preventDefault());

	/** 현재 baseMode가 mode인 순간에 일어난 pointerdown만 통과시킨다 */
	function pointerDownFor(mode: BaseMode): Observable<PointerEvent> {
		return pointerDown$.pipe(
			withLatestFrom(baseMode$),
			filter(([, m]) => m === mode),
			map(([e]) => e)
		);
	}

	/** 한 포인터의 드래그 제스처를 pointerup/cancel 또는 모드 이탈 시점까지로 한정 짓는다 */
	function gestureBounds(
		downEvent: PointerEvent,
		mode: BaseMode
	): { move$: Observable<PointerEvent>; end$: Observable<unknown> } {
		canvas.setPointerCapture(downEvent.pointerId);
		return {
			move$: pointerMove$.pipe(filter((e) => e.pointerId === downEvent.pointerId)),
			end$: merge(
				pointerUp$.pipe(filter((e) => e.pointerId === downEvent.pointerId)),
				pointerCancel$.pipe(filter((e) => e.pointerId === downEvent.pointerId)),
				baseMode$.pipe(filter((m) => m !== mode))
			)
		};
	}

	const pan$: Observable<PanDelta> = pointerDownFor('pan').pipe(
		exhaustMap((downEvent) => {
			let lastX = downEvent.clientX;
			let lastY = downEvent.clientY;
			const { move$, end$ } = gestureBounds(downEvent, 'pan');
			return move$.pipe(
				map((e) => {
					const delta: PanDelta = { dxScreen: e.clientX - lastX, dyScreen: e.clientY - lastY };
					lastX = e.clientX;
					lastY = e.clientY;
					return delta;
				}),
				takeUntil(end$)
			);
		})
	);

	const zoomDrag$: Observable<ZoomGesture> = pointerDownFor('zoom').pipe(
		exhaustMap((downEvent) => {
			const anchor = toCanvasLocal(canvas, downEvent.clientX, downEvent.clientY);
			let lastY = downEvent.clientY;
			const { move$, end$ } = gestureBounds(downEvent, 'zoom');
			return move$.pipe(
				map((e) => {
					const dy = e.clientY - lastY;
					lastY = e.clientY;
					// 위로 드래그(dy<0)하면 확대, 아래로 드래그하면 축소 (Krita 관례). 드래그 시작점을 계속 고정 앵커로 쓴다.
					const factor = Math.exp(-dy * 0.01);
					return { factor, anchorScreenX: anchor.x, anchorScreenY: anchor.y };
				}),
				takeUntil(end$)
			);
		})
	);

	const wheelZoom$: Observable<ZoomGesture> = fromEvent<WheelEvent>(canvas, 'wheel', {
		passive: false
	}).pipe(
		tap((e) => e.preventDefault()),
		map((e) => {
			const anchor = toCanvasLocal(canvas, e.clientX, e.clientY);
			const factor = Math.exp(-e.deltaY * 0.001);
			return { factor, anchorScreenX: anchor.x, anchorScreenY: anchor.y };
		})
	);

	// press space(pan 모드 진입) -> drag(포인터다운~업/취소) -> release(pan 모드 이탈) 생명주기를
	// 그대로 커서 상태로 매핑한다. baseMode$가 이미 space/ctrl의 press~release를 반영하므로,
	// 여기서는 "그 사이에 실제로 드래그 중인가"만 더해 grab/grabbing을 구분한다.
	const panDragActive$: Observable<boolean> = merge(
		pointerDownFor('pan').pipe(map(() => true)),
		pointerUp$.pipe(map(() => false)),
		pointerCancel$.pipe(map(() => false))
	).pipe(startWith(false), distinctUntilChanged());

	const cursorMode$: Observable<CursorMode> = combineLatest([baseMode$, panDragActive$]).pipe(
		map(([mode, dragging]): CursorMode => {
			if (mode === 'zoom') return 'zoom';
			if (mode === 'pan') return dragging ? 'grabbing' : 'grab';
			if (mode === 'eyedropper') return 'eyedropper';
			return 'draw';
		}),
		distinctUntilChanged(),
		shareReplay({ bufferSize: 1, refCount: true })
	);

	return {
		baseMode$,
		cursorMode$,
		pointerDown$,
		pointerMove$,
		pointerUp$,
		pointerCancel$,
		pointerEnter$,
		pointerLeave$,
		pan$,
		zoomDrag$,
		wheelZoom$,
		toggleTool$
	};
}
