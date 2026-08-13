/**
 * 뷰포트 기반 타일 런타임 캐시.
 *
 * Dexie(tilePixels)에 있는 원본 픽셀을 뷰포트에 걸치는 타일만 OffscreenCanvas로 디코딩해
 * 메모리에 올리고, 뷰포트를 벗어난 타일은 내린다. Dexie가 항상 최신 상태를 갖고 있으므로
 * (스트로크 종료 시 즉시 flush, M5) 메모리에서 내리는 것은 안전하다 — 다시 뷰포트에 들어오면
 * 그대로 다시 로드하면 된다.
 *
 * 컴포지팅(레이어 블렌드)은 렌더러가 매 렌더 시점에 이 레이어별 캔버스들을 가지고 직접 수행한다
 * (탭당 캔버스 수가 적어 매번 다시 그려도 비용이 크지 않으므로, 별도 컴포지트 캐시를 두지 않았다).
 */
import { db } from './db';
import { TILE_SIZE, tilePixelsRecordId, type TileCoord } from './types';

export interface LoadedTile {
	x: number;
	y: number;
	/** layerId -> 해당 레이어의 원본 픽셀을 담은 OffscreenCanvas */
	layerCanvases: Map<string, OffscreenCanvas>;
}

export function tileKey(x: number, y: number): string {
	return `${x}:${y}`;
}

export class TileStore {
	readonly documentId: string;
	#onChange: () => void;
	#tiles = new Map<string, LoadedTile>();
	#existingTileKeys = new Set<string>();
	#pendingLoads = new Set<string>();

	constructor(documentId: string, onChange: () => void) {
		this.documentId = documentId;
		this.#onChange = onChange;
	}

	/** 이 도큐먼트에 실제로 존재하는(무언가 그려진) 타일 좌표 목록을 Dexie에서 다시 읽어온다 */
	async refreshExistingTiles(): Promise<void> {
		const tiles = await db.tiles.where('documentId').equals(this.documentId).toArray();
		this.#existingTileKeys = new Set(tiles.map((tile) => tileKey(tile.x, tile.y)));
		this.#onChange();
	}

	hasTile(x: number, y: number): boolean {
		return this.#existingTileKeys.has(tileKey(x, y));
	}

	/** 새로 그려져 방금 생겼거나(M3) 하이드레이션된 타일을 존재 목록에 반영한다 */
	markTileExists(x: number, y: number): void {
		this.#existingTileKeys.add(tileKey(x, y));
	}

	get(x: number, y: number): LoadedTile | undefined {
		return this.#tiles.get(tileKey(x, y));
	}

	/** 넘겨준 좌표들 중, 실제 존재하지만 아직 메모리에 없는 타일을 비동기로 로드한다 */
	ensureLoaded(coords: TileCoord[], layerIds: readonly string[]): void {
		for (const { x, y } of coords) {
			const key = tileKey(x, y);
			if (!this.#existingTileKeys.has(key)) continue;
			if (this.#tiles.has(key) || this.#pendingLoads.has(key)) continue;

			this.#pendingLoads.add(key);
			this.#loadTile(x, y, layerIds)
				.catch((err: unknown) => console.error(`타일 로드 실패 (${x}, ${y})`, err))
				.finally(() => this.#pendingLoads.delete(key));
		}
	}

	async #loadTile(x: number, y: number, layerIds: readonly string[]): Promise<void> {
		const layerCanvases = new Map<string, OffscreenCanvas>();

		for (const layerId of layerIds) {
			const record = await db.tilePixels.get(tilePixelsRecordId(this.documentId, x, y, layerId));
			const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
			if (record) {
				const ctx = canvas.getContext('2d');
				if (!ctx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');
				const imageData = new ImageData(new Uint8ClampedArray(record.pixels), TILE_SIZE, TILE_SIZE);
				ctx.putImageData(imageData, 0, 0);
			}
			layerCanvases.set(layerId, canvas);
		}

		this.#tiles.set(tileKey(x, y), { x, y, layerCanvases });
		this.#onChange();
	}

	/**
	 * 그리기(브러시 스탬프)를 위해 타일을 동기적으로 확보한다.
	 * - 이미 메모리에 있으면 그대로 반환하고, 요청한 레이어 중 아직 캔버스가 없는 것만 빈 캔버스로 채운다.
	 * - 실제로 존재하는 타일인데 아직 비동기 로드가 끝나지 않았다면, 로드를 트리거만 하고 null을 반환한다
	 *   (원본 픽셀을 빈 캔버스로 덮어써버리는 경쟁조건을 피하기 위해 — 다음 스탬프에서 다시 시도하면 된다).
	 * - 완전히 새 타일(섬처럼 고립되어 생기는 경우 포함)이면 빈 캔버스로 즉시 만든다.
	 */
	getForDrawing(x: number, y: number, layerIds: readonly string[]): LoadedTile | null {
		const key = tileKey(x, y);
		const existing = this.#tiles.get(key);
		if (existing) {
			for (const layerId of layerIds) {
				if (!existing.layerCanvases.has(layerId)) {
					existing.layerCanvases.set(layerId, new OffscreenCanvas(TILE_SIZE, TILE_SIZE));
				}
			}
			return existing;
		}

		if (this.#existingTileKeys.has(key)) {
			this.ensureLoaded([{ x, y }], layerIds);
			return null;
		}

		const layerCanvases = new Map<string, OffscreenCanvas>();
		for (const layerId of layerIds) {
			layerCanvases.set(layerId, new OffscreenCanvas(TILE_SIZE, TILE_SIZE));
		}
		const tile: LoadedTile = { x, y, layerCanvases };
		this.#tiles.set(key, tile);
		this.#existingTileKeys.add(key);
		this.#onChange();
		return tile;
	}

	/** keep에 없는, 메모리에 로드되어 있던 타일을 전부 내린다 */
	evictOutside(keep: ReadonlySet<string>): void {
		let changed = false;
		for (const key of this.#tiles.keys()) {
			if (!keep.has(key)) {
				this.#tiles.delete(key);
				changed = true;
			}
		}
		if (changed) this.#onChange();
	}
}
