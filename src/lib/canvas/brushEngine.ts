/**
 * 펜 스트로크 FSM (RxJS).
 *
 * pointerdown(모드가 draw일 때만) → exhaustMap으로 스트로크 스트림을 열고,
 * pointermove(getCoalescedEvents로 펼침) → takeUntil(pointerup/cancel 또는 모드 이탈)로 닫는다.
 * 스탬프 간격 보간은 스트로크 전체에 대해 월드 좌표 기준으로 한 번만 계산하며(scan), 각 스탬프는
 * 자신이 걸치는 모든 타일에 동일한 지오메트리를 정수 타일 오프셋만큼만 옮겨 그려 타일 경계에서
 * 이음매 없이 이어지도록 한다. finalize()에서 스트로크 커밋(터치된 타일 dirty 마킹 + Dexie flush)을
 * 한 곳에서 처리한다.
 */
import { EMPTY, from, merge, of, type Observable } from 'rxjs';
import {
	exhaustMap,
	filter,
	finalize,
	map,
	mergeMap,
	scan,
	takeUntil,
	tap,
	withLatestFrom
} from 'rxjs/operators';
import type { CanvasInput } from './input';
import { db } from './db';
import { TILE_SIZE, tilePixelsRecordId, tileRecordId, type Tool } from './types';
import { tileKey, type TileStore } from './tileStore';
import type { Viewport } from './viewport.svelte';

export interface BrushSettings {
	tool: Tool;
	brushSize: number;
	eraserSize: number;
	color: string;
}

export interface StampPoint {
	worldX: number;
	worldY: number;
	pressure: number;
}

export interface StampState {
	started: boolean;
	lastX: number;
	lastY: number;
	lastPressure: number;
	pendingStamps: StampPoint[];
}

export const INITIAL_STAMP_STATE: StampState = {
	started: false,
	lastX: 0,
	lastY: 0,
	lastPressure: 0,
	pendingStamps: []
};

/** 필압을 반경으로 매핑한다. 마우스는 필압 센서가 없으므로 항상 최대 굵기로 취급한다 */
export function pressureToRadius(baseSize: number, pressure: number, pointerType: string): number {
	const minFactor = 0.2;
	const effectivePressure = pointerType === 'mouse' ? 1 : pressure;
	const factor = minFactor + (1 - minFactor) * effectivePressure;
	return Math.max(0.5, (baseSize / 2) * factor);
}

function toStampPoint(canvas: HTMLCanvasElement, viewport: Viewport, e: PointerEvent): StampPoint {
	const rect = canvas.getBoundingClientRect();
	const world = viewport.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
	// PointerEvent.pressure는 버튼이 눌린 마우스에서 스펙상 0.5로 고정 보고되므로 그대로 쓰지 않는다
	const pressure = e.pointerType === 'pen' ? e.pressure : 1;
	return { worldX: world.x, worldY: world.y, pressure };
}

/** 이전 스탬프 위치부터 현재 포인터 위치까지, 간격(spacing)마다 스탬프를 보간해 채운다 */
export function accumulateStamps(
	state: StampState,
	point: StampPoint,
	spacing: number
): StampState {
	if (!state.started) {
		return {
			started: true,
			lastX: point.worldX,
			lastY: point.worldY,
			lastPressure: point.pressure,
			pendingStamps: [point]
		};
	}

	const dx = point.worldX - state.lastX;
	const dy = point.worldY - state.lastY;
	const dist = Math.hypot(dx, dy);

	if (dist < spacing) {
		return { ...state, pendingStamps: [] };
	}

	const stamps: StampPoint[] = [];
	let travelled = 0;
	while (travelled + spacing <= dist) {
		travelled += spacing;
		const t = travelled / dist;
		stamps.push({
			worldX: state.lastX + dx * t,
			worldY: state.lastY + dy * t,
			pressure: state.lastPressure + (point.pressure - state.lastPressure) * t
		});
	}

	return {
		started: true,
		lastX: point.worldX,
		lastY: point.worldY,
		lastPressure: point.pressure,
		pendingStamps: stamps
	};
}

/** 스탬프 하나를 그 스탬프가 걸치는 모든 타일에 동일한 지오메트리로 그린다 (타일 경계 seamless 처리) */
function drawStamp(
	tileStore: TileStore,
	layerId: string,
	stamp: StampPoint,
	radius: number,
	tool: Tool,
	color: string,
	touchedTiles: Set<string>
): void {
	const minTileX = Math.floor((stamp.worldX - radius) / TILE_SIZE);
	const maxTileX = Math.floor((stamp.worldX + radius) / TILE_SIZE);
	const minTileY = Math.floor((stamp.worldY - radius) / TILE_SIZE);
	const maxTileY = Math.floor((stamp.worldY + radius) / TILE_SIZE);

	for (let ty = minTileY; ty <= maxTileY; ty++) {
		for (let tx = minTileX; tx <= maxTileX; tx++) {
			const tile = tileStore.getForDrawing(tx, ty, [layerId]);
			if (!tile) continue; // 아직 로드 중 — 다음 스탬프에서 다시 시도된다

			const canvas = tile.layerCanvases.get(layerId);
			const ctx = canvas?.getContext('2d');
			if (!ctx) continue;

			const localX = stamp.worldX - tx * TILE_SIZE;
			const localY = stamp.worldY - ty * TILE_SIZE;

			ctx.save();
			ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(localX, localY, radius, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();

			touchedTiles.add(tileKey(tx, ty));
		}
	}
}

/** 스트로크 종료 시, 이번 스트로크가 건드린 타일들을 즉시 Dexie(작업 영역)에 반영한다 */
async function flushTouchedTiles(
	documentId: string,
	tileStore: TileStore,
	layerId: string,
	touchedTileKeys: Set<string>
): Promise<void> {
	if (touchedTileKeys.size === 0) return;
	const now = Date.now();

	for (const key of touchedTileKeys) {
		const [xStr, yStr] = key.split(':');
		const x = Number(xStr);
		const y = Number(yStr);
		const canvas = tileStore.get(x, y)?.layerCanvases.get(layerId);
		const ctx = canvas?.getContext('2d');
		if (!ctx) continue;

		const pixels = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data.buffer;

		await db.transaction('rw', db.tiles, db.tilePixels, db.documents, async () => {
			await db.tiles.put({ id: tileRecordId(documentId, x, y), documentId, x, y, dirty: true });
			await db.tilePixels.put({
				id: tilePixelsRecordId(documentId, x, y, layerId),
				documentId,
				x,
				y,
				layerId,
				pixels,
				webpCache: null
			});
			await db.documents.update(documentId, { updatedAt: now });
		});
	}
}

export interface StrokeControllerOptions {
	canvas: HTMLCanvasElement;
	input: CanvasInput;
	viewport: Viewport;
	/**
	 * tileStore/documentId를 값이 아니라 getter로 받는다 — 이 스트림은 캔버스가 마운트될 때
	 * 한 번만 만들어지지만, 도큐먼트 전환(M7)으로 그 사이 tileStore/documentId가 바뀔 수 있으므로
	 * 스트로크가 시작되는 시점마다 최신 값을 다시 읽어야 한다.
	 */
	getTileStore: () => TileStore | null;
	getDocumentId: () => string | null;
	getActiveLayerId: () => string | null;
	getSettings: () => BrushSettings;
	onChange: () => void;
}

/** 스트로크 FSM을 구독 가능한 스트림으로 만들어 반환한다 (호출부가 subscribe/unsubscribe로 생명주기 관리) */
export function createStroke$(opts: StrokeControllerOptions): Observable<void> {
	const {
		canvas,
		input,
		viewport,
		getTileStore,
		getDocumentId,
		getActiveLayerId,
		getSettings,
		onChange
	} = opts;

	return input.pointerDown$.pipe(
		withLatestFrom(input.baseMode$),
		filter(([, mode]) => mode === 'draw'),
		map(([e]) => e),
		exhaustMap((downEvent) => {
			const layerId = getActiveLayerId();
			const tileStore = getTileStore();
			const documentId = getDocumentId();
			if (layerId === null || tileStore === null || documentId === null) return EMPTY;

			canvas.setPointerCapture(downEvent.pointerId);
			const settings = getSettings();
			const baseSize = settings.tool === 'eraser' ? settings.eraserSize : settings.brushSize;
			const spacing = Math.max(1, baseSize * 0.15);
			const touchedTiles = new Set<string>();

			const move$ = input.pointerMove$.pipe(filter((e) => e.pointerId === downEvent.pointerId));
			const end$ = merge(
				input.pointerUp$.pipe(filter((e) => e.pointerId === downEvent.pointerId)),
				input.pointerCancel$.pipe(filter((e) => e.pointerId === downEvent.pointerId)),
				input.baseMode$.pipe(filter((mode) => mode !== 'draw'))
			);

			return merge(of(downEvent), move$).pipe(
				mergeMap((e) => from(e.getCoalescedEvents?.() ?? [e])),
				map((e) => toStampPoint(canvas, viewport, e)),
				scan((state, point) => accumulateStamps(state, point, spacing), INITIAL_STAMP_STATE),
				mergeMap((state) => from(state.pendingStamps)),
				tap((stamp) => {
					const radius = pressureToRadius(baseSize, stamp.pressure, downEvent.pointerType);
					drawStamp(tileStore, layerId, stamp, radius, settings.tool, settings.color, touchedTiles);
					onChange();
				}),
				takeUntil(end$),
				finalize(() => {
					void flushTouchedTiles(documentId, tileStore, layerId, touchedTiles);
				}),
				map(() => undefined)
			);
		})
	);
}
