/**
 * 스포이드(컬러 피커) — Space 없이 Ctrl만 누른 상태(input.ts의 baseMode 'eyedropper')의
 * pointerdown, 또는 스포이드가 활성 도구(toolState.tool === 'eyedropper')로 선택된 상태의
 * pointerdown에서 그 좌표의 "활성 레이어" 픽셀 색을 읽어온다.
 *
 * 레이어 합성(블렌드) 결과가 아니라 활성 레이어의 원본 픽셀만 읽는다 — TileStore가 이미 레이어별로
 * 분리된 OffscreenCanvas(layerCanvases)를 들고 있으므로 activeLayerId 하나만 보면 되고, 렌더러가
 * 매 프레임 수행하는 컴포지팅과는 무관하다.
 */
import type { Observable } from 'rxjs';
import { filter, map, tap, withLatestFrom } from 'rxjs/operators';
import type { CanvasInput } from './input';
import { rgbToHex } from './color';
import { TILE_SIZE, type Tool } from './types';
import type { TileStore } from './tileStore';
import type { Viewport } from './viewport.svelte';

/** 월드 좌표가 속한 타일 좌표와, 그 타일 캔버스 내부에서의 로컬 픽셀 좌표로 변환한다 */
export function worldToTilePixel(
	worldX: number,
	worldY: number
): { tileX: number; tileY: number; pixelX: number; pixelY: number } {
	const tileX = Math.floor(worldX / TILE_SIZE);
	const tileY = Math.floor(worldY / TILE_SIZE);
	return {
		tileX,
		tileY,
		pixelX: Math.floor(worldX - tileX * TILE_SIZE),
		pixelY: Math.floor(worldY - tileY * TILE_SIZE)
	};
}

/**
 * 활성 레이어의 해당 좌표 픽셀을 hex로 반환한다. 완전 투명(alpha=0) 픽셀이거나 타일/레이어가
 * 아직 로드되지 않았으면 뽑을 색이 없으므로 null을 반환한다(전경색을 바꾸지 않고 그대로 둔다).
 */
export function sampleLayerColor(
	tileStore: TileStore,
	layerId: string,
	worldX: number,
	worldY: number
): string | null {
	const { tileX, tileY, pixelX, pixelY } = worldToTilePixel(worldX, worldY);
	const canvas = tileStore.get(tileX, tileY)?.layerCanvases.get(layerId);
	const ctx = canvas?.getContext('2d');
	if (!ctx) return null;

	const [r, g, b, a] = ctx.getImageData(pixelX, pixelY, 1, 1).data;
	if (a === 0) return null;
	return rgbToHex({ r, g, b });
}

export interface EyedropperOptions {
	canvas: HTMLCanvasElement;
	input: CanvasInput;
	viewport: Viewport;
	getTileStore: () => TileStore | null;
	getActiveLayerId: () => string | null;
	getTool: () => Tool;
	onPick: (hex: string) => void;
}

/** 호출부가 subscribe/unsubscribe로 생명주기를 관리하는 스트림 (brushEngine의 createStroke$와 동일한 스타일) */
export function createEyedropperPick$(opts: EyedropperOptions): Observable<void> {
	const { canvas, input, viewport, getTileStore, getActiveLayerId, getTool, onPick } = opts;

	return input.pointerDown$.pipe(
		withLatestFrom(input.baseMode$),
		filter(([, mode]) => mode === 'eyedropper' || (mode === 'draw' && getTool() === 'eyedropper')),
		map(([e]) => e),
		tap((e) => {
			const tileStore = getTileStore();
			const layerId = getActiveLayerId();
			if (!tileStore || !layerId) return;

			const rect = canvas.getBoundingClientRect();
			const world = viewport.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
			const hex = sampleLayerColor(tileStore, layerId, world.x, world.y);
			if (hex) onPick(hex);
		}),
		map(() => undefined)
	);
}
