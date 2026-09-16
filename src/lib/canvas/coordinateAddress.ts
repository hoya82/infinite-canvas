/**
 * 레이어 패널 위 좌표 표시줄이 쓰는 "뷰포트 주소" — 뷰포트 정중앙의 월드 좌표를 타일 단위
 * 부동소수점(소수점 2자리)으로, 줌도 부동소수점(소수점 1자리, 0.1 단위)으로 표현해 URL 쿼리
 * 문자열로 직렬화/역직렬화한다. 예: (0,0) 타일 한가운데를 보고 있으면 좌표는 (0.5, 0.5)다.
 */
import { TILE_SIZE } from './types';
import type { Viewport } from './viewport.svelte';

export interface ViewportAddress {
	/** 타일 단위 부동소수점 (worldPixel / TILE_SIZE) */
	x: number;
	y: number;
	/** 부동소수점 줌 레벨, 0.1 단위 */
	zoom: number;
}

const COORDINATE_DECIMALS = 2;
const ZOOM_DECIMALS = 1;

/** 0.1 단위로 반올림한다 (10배 해서 정수로 반올림 후 다시 나누는 편이 부동소수점 오차가 적다) */
export function roundToTenth(value: number): number {
	return Math.round(value * 10) / 10;
}

/** 현재 뷰포트 정중앙을 타일 단위 좌표 + 0.1 단위 줌으로 읽는다 */
export function getViewportAddress(viewport: Viewport): ViewportAddress {
	const center = viewport.centerWorld();
	return {
		x: center.x / TILE_SIZE,
		y: center.y / TILE_SIZE,
		zoom: roundToTenth(viewport.zoom)
	};
}

/** 뷰포트 정중앙이 주어진 주소를 가리키도록 이동한다(줌도 함께 적용) */
export function jumpToAddress(viewport: Viewport, address: ViewportAddress): void {
	viewport.jumpTo(address.x * TILE_SIZE, address.y * TILE_SIZE, address.zoom);
}

/** 좌표 표시용 — 소수점 둘째 자리까지 */
export function formatCoordinate(value: number): string {
	return value.toFixed(COORDINATE_DECIMALS);
}

/** 줌 표시용 — 소수점 첫째 자리까지(0.1 단위) */
export function formatZoom(value: number): string {
	return value.toFixed(ZOOM_DECIMALS);
}

/**
 * 클립보드 복사 형식: `<현재 URL의 origin+path>?x=17.54&y=-88.12&zoom=14.0`.
 * 기존에 페이지 URL에 붙어 있던 다른 쿼리 파라미터는 버리고 x/y/zoom만 남긴다.
 */
export function buildAddressUrl(address: ViewportAddress, currentHref: string): string {
	const url = new URL(currentHref);
	url.search = '';
	url.searchParams.set('x', formatCoordinate(address.x));
	url.searchParams.set('y', formatCoordinate(address.y));
	url.searchParams.set('zoom', formatZoom(address.zoom));
	return url.toString();
}

/**
 * 좌표 URL을 파싱한다 — 전체 URL(`https://.../?x=..&y=..&zoom=..`)이든, 물음표로 시작하는
 * 쿼리 문자열(`?x=..&y=..&zoom=..`)이든, 물음표 없는 쿼리 문자열(`x=..&y=..&zoom=..`)이든
 * 전부 받아들인다. x/y/zoom 중 하나라도 유효한 숫자가 아니면 null.
 */
export function parseAddressInput(text: string): ViewportAddress | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	let params: URLSearchParams;
	try {
		params = new URL(trimmed).searchParams;
	} catch {
		params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed);
	}

	// URLSearchParams.get()은 키가 없으면 null을 반환하는데 Number(null) === 0이라, 없음(null)과
	// 명시적으로 "0"인 경우를 구분하려면 has()로 먼저 존재 여부를 확인해야 한다.
	if (!params.has('x') || !params.has('y') || !params.has('zoom')) return null;

	const x = Number(params.get('x'));
	const y = Number(params.get('y'));
	const zoom = Number(params.get('zoom'));
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;

	return { x, y, zoom: roundToTenth(zoom) };
}

let initialUrlAddressConsumed = false;

/**
 * 페이지가 열릴 때 주소창에 좌표 쿼리(`?x=..&y=..&zoom=..`)가 있으면 앱 세션당 딱 한 번만
 * 읽어온다. 도큐먼트 전환으로 CanvasStage가 재마운트되어도(뷰포트가 기본값으로 리셋되는 기존
 * 동작은 그대로 두고) 이 초기 주소가 다시 적용되지는 않는다 — 어디까지나 "링크로 열었을 때
 * 한 번" 점프하기 위한 것이지, 매 문서 전환마다 되풀이할 동작이 아니다.
 */
export function consumeInitialUrlAddress(search: string): ViewportAddress | null {
	if (initialUrlAddressConsumed) return null;
	initialUrlAddressConsumed = true;
	return parseAddressInput(search);
}
