import { describe, expect, it } from 'vitest';
import {
	buildAddressUrl,
	consumeInitialUrlAddress,
	formatCoordinate,
	formatZoom,
	getViewportAddress,
	jumpToAddress,
	parseAddressInput,
	roundToTenth
} from './coordinateAddress';
import { TILE_SIZE } from './types';
import { Viewport } from './viewport.svelte';

function makeViewport(width: number, height: number): Viewport {
	const viewport = new Viewport();
	viewport.width = width;
	viewport.height = height;
	return viewport;
}

describe('getViewportAddress', () => {
	it('(0,0) 타일의 정중앙을 보고 있으면 좌표는 (0.5, 0.5)다', () => {
		const viewport = makeViewport(TILE_SIZE, TILE_SIZE);
		viewport.panX = 0;
		viewport.panY = 0;
		viewport.zoom = 1;

		expect(getViewportAddress(viewport)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
	});

	it('좌측/상단으로 움직이면 좌표가 음수가 된다', () => {
		const viewport = makeViewport(TILE_SIZE, TILE_SIZE);
		viewport.panX = -TILE_SIZE * 2;
		viewport.panY = -TILE_SIZE * 2;
		viewport.zoom = 1;

		const address = getViewportAddress(viewport);
		expect(address.x).toBeLessThan(0);
		expect(address.y).toBeLessThan(0);
	});

	it('줌은 0.1 단위로 반올림한다', () => {
		const viewport = makeViewport(TILE_SIZE, TILE_SIZE);
		viewport.zoom = 3.74;
		expect(getViewportAddress(viewport).zoom).toBe(3.7);
	});
});

describe('jumpToAddress', () => {
	it('주어진 주소로 이동한 뒤 다시 읽으면 같은 주소를 얻는다(왕복)', () => {
		const viewport = makeViewport(800, 600);
		const address = { x: 12.5, y: -3.25, zoom: 8.4 };

		jumpToAddress(viewport, address);

		expect(getViewportAddress(viewport)).toEqual(address);
	});
});

describe('formatCoordinate', () => {
	it('소수점 둘째 자리까지 표시한다', () => {
		expect(formatCoordinate(0.5)).toBe('0.50');
		expect(formatCoordinate(-88.1234)).toBe('-88.12');
		expect(formatCoordinate(17.5)).toBe('17.50');
	});
});

describe('formatZoom', () => {
	it('소수점 첫째 자리까지 표시한다', () => {
		expect(formatZoom(1)).toBe('1.0');
		expect(formatZoom(13.8)).toBe('13.8');
	});
});

describe('roundToTenth', () => {
	it('0.1 단위로 반올림한다', () => {
		expect(roundToTenth(3.74)).toBe(3.7);
		expect(roundToTenth(3.76)).toBe(3.8);
		expect(roundToTenth(14)).toBe(14);
	});
});

describe('buildAddressUrl', () => {
	it('baseurl?x=..&y=..&zoom=.. 형식의 URL을 만든다', () => {
		const url = buildAddressUrl({ x: 17.54, y: -88.12, zoom: 14.2 }, 'https://example.com/app');
		expect(url).toBe('https://example.com/app?x=17.54&y=-88.12&zoom=14.2');
	});

	it('기존 URL에 남아있던 다른 쿼리 파라미터는 버리고 x/y/zoom만 남긴다', () => {
		const url = buildAddressUrl(
			{ x: 1, y: 2, zoom: 3 },
			'https://example.com/app?x=99&y=99&zoom=99&stale=1'
		);
		expect(url).toBe('https://example.com/app?x=1.00&y=2.00&zoom=3.0');
	});
});

describe('parseAddressInput', () => {
	it('전체 URL에서 x/y/zoom을 파싱한다', () => {
		expect(parseAddressInput('https://example.com/app?x=17.54&y=-88.12&zoom=14.2')).toEqual({
			x: 17.54,
			y: -88.12,
			zoom: 14.2
		});
	});

	it('물음표로 시작하는 쿼리 문자열만 와도 파싱한다', () => {
		expect(parseAddressInput('?x=1&y=2&zoom=3.5')).toEqual({ x: 1, y: 2, zoom: 3.5 });
	});

	it('물음표 없는 쿼리 문자열도 파싱한다', () => {
		expect(parseAddressInput('x=1&y=2&zoom=3.5')).toEqual({ x: 1, y: 2, zoom: 3.5 });
	});

	it('zoom은 0.1 단위로 반올림한다', () => {
		expect(parseAddressInput('x=1&y=2&zoom=3.94')).toEqual({ x: 1, y: 2, zoom: 3.9 });
	});

	it('x/y/zoom 중 하나라도 없거나 숫자가 아니면 null', () => {
		expect(parseAddressInput('x=1&y=2')).toBeNull();
		expect(parseAddressInput('x=abc&y=2&zoom=3')).toBeNull();
		expect(parseAddressInput('')).toBeNull();
		expect(parseAddressInput('   ')).toBeNull();
		expect(parseAddressInput('완전히 관계없는 텍스트')).toBeNull();
	});
});

describe('consumeInitialUrlAddress', () => {
	it('앱 세션당 딱 한 번만 값을 반환하고, 그다음부터는 null이다', () => {
		const first = consumeInitialUrlAddress('?x=1&y=2&zoom=3');
		expect(first).toEqual({ x: 1, y: 2, zoom: 3 });

		const second = consumeInitialUrlAddress('?x=99&y=99&zoom=99');
		expect(second).toBeNull();
	});
});
