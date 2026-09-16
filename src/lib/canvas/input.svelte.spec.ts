import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasInput, type BaseMode } from './input';

describe('createCanvasInput — 롱프레스 컨텍스트 메뉴 억제', () => {
	let canvas: HTMLCanvasElement | null = null;

	afterEach(() => {
		canvas?.remove();
		canvas = null;
	});

	function mount(): HTMLCanvasElement {
		const el = document.createElement('canvas');
		document.body.appendChild(el);
		canvas = el;
		createCanvasInput(el);
		return el;
	}

	it('button=0(실제 버튼 없이 롱프레스로 합성된 이벤트)인 contextmenu는 막는다', () => {
		const el = mount();
		const event = new MouseEvent('contextmenu', { button: 0, cancelable: true, bubbles: true });

		el.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});

	it('button=2(펜 사이드 스위치나 마우스 우클릭 같은 진짜 보조 버튼)인 contextmenu는 막지 않는다', () => {
		const el = mount();
		const event = new MouseEvent('contextmenu', { button: 2, cancelable: true, bubbles: true });

		el.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});
});

describe('createCanvasInput — baseMode$과 입력 필드 포커스', () => {
	let canvas: HTMLCanvasElement | null = null;
	let input: HTMLInputElement | null = null;

	afterEach(() => {
		canvas?.remove();
		input?.remove();
		canvas = null;
		input = null;
	});

	function mountWithInput(): {
		canvas: HTMLCanvasElement;
		input: HTMLInputElement;
		modes: BaseMode[];
	} {
		canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		input = document.createElement('input');
		document.body.appendChild(input);

		const { baseMode$ } = createCanvasInput(canvas);
		const modes: BaseMode[] = [];
		baseMode$.subscribe((mode) => modes.push(mode));
		return { canvas, input, modes };
	}

	// 회귀 테스트: Ctrl+V(붙여넣기)/Ctrl+C/Ctrl+A 등 텍스트 편집 단축키가 입력 필드에서 눌릴 때마다
	// 매번 e.ctrlKey===true인 keydown이 발생하는데, 이전 구현은 이걸 무조건 "eyedropper 모드
	// 진입"으로 해석해 캔버스 커서가 스포이드로 바뀌는 등 붙여넣기와 충돌했다.
	it('입력 필드에 포커스가 있는 동안 Ctrl을 누르면(Ctrl+V 등) eyedropper 모드로 바뀌지 않는다', () => {
		const { input, modes } = mountWithInput();
		input.focus();

		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));

		expect(modes.at(-1)).toBe('draw');
	});

	it('입력 필드가 아닌 곳(캔버스 등)에서 Ctrl을 누르면 eyedropper 모드로 바뀐다', () => {
		const { modes } = mountWithInput();

		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true })
		);

		expect(modes.at(-1)).toBe('eyedropper');
	});

	it('Ctrl을 뗄 때(keyup)는 입력 필드에 포커스가 있어도 걸러지지 않아 눌림 상태가 고정되지 않는다', () => {
		const { input, modes } = mountWithInput();

		document.body.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true })
		);
		expect(modes.at(-1)).toBe('eyedropper');

		// 그 사이 포커스가 입력 필드로 옮겨간 채로 Ctrl을 뗀다
		input.focus();
		input.dispatchEvent(
			new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, bubbles: true })
		);

		expect(modes.at(-1)).toBe('draw');
	});
});
