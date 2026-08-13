import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasInput } from './input';

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
