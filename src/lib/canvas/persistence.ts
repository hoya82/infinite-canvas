/**
 * 수동 저장(title.infcanvas)과 자동 저장(.autosave-title.infcanvas)을 별도 파일로 분리해
 * OPFS에 기록한다. 두 경로 모두 이 모듈의 saveDocument를 공유하며, dirty 타일만 webp로
 * 재인코딩하고(webpWorkerPool 병렬 처리) 나머지는 tilePixels.webpCache에 저장된 이전 인코딩
 * 결과를 그대로 재사용한다 — 자동 저장이 먼저 재인코딩해 두면 뒤이은 수동 저장(혹은 그 반대)은
 * 캐시를 그대로 쓰므로 같은 내용을 두 번 인코딩하지 않는다.
 */
import {
	CONTAINER_FORMAT_VERSION,
	packContainer,
	type ContainerManifest,
	type TextureEntry,
	type TileImageEntry
} from './container';
import { db } from './db';
import * as opfs from './opfs';
import { tilePixelsRecordId, type CanvasDocument, type Layer, type TileRecord } from './types';
import { webpWorkerPool } from './webpWorkerPool';

export type SaveKind = 'manual' | 'autosave';

function toManifest(doc: CanvasDocument, layers: Layer[], tiles: TileRecord[]): ContainerManifest {
	return {
		formatVersion: CONTAINER_FORMAT_VERSION,
		title: doc.title,
		background: doc.background,
		layers: layers
			.slice()
			.sort((a, b) => a.order - b.order)
			.map((layer) => ({
				id: layer.id,
				name: layer.name,
				mode: layer.mode,
				opacity: layer.opacity,
				visible: layer.visible,
				order: layer.order
			})),
		tiles: tiles.map((tile) => ({ x: tile.x, y: tile.y })),
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt
	};
}

/** dirty 타일 × 레이어 조합의 픽셀만 webp로 재인코딩해 webpCache를 채운다 */
async function reencodeDirtyTiles(
	documentId: string,
	dirtyTiles: TileRecord[],
	layerIds: readonly string[]
): Promise<void> {
	const jobs = dirtyTiles.flatMap((tile) =>
		layerIds.map(async (layerId) => {
			const id = tilePixelsRecordId(documentId, tile.x, tile.y, layerId);
			const record = await db.tilePixels.get(id);
			if (!record) return; // 이 타일에는 이 레이어가 그려진 적이 없음
			// 워커로 전송(transfer)하면 이 buffer는 더 이상 못 쓰게 되므로 복사본을 넘긴다
			const webp = await webpWorkerPool.encode(record.pixels.slice(0));
			await db.tilePixels.update(id, { webpCache: webp });
		})
	);
	await Promise.all(jobs);
}

export async function saveDocument(documentId: string, kind: SaveKind): Promise<void> {
	const doc = await db.documents.get(documentId);
	if (!doc) throw new Error(`도큐먼트를 찾을 수 없습니다: ${documentId}`);

	const layers = await db.layers.where('documentId').equals(documentId).sortBy('order');
	const tiles = await db.tiles.where('documentId').equals(documentId).toArray();
	const dirtyTiles = tiles.filter((tile) => tile.dirty);
	const layerIds = layers.map((layer) => layer.id);

	if (dirtyTiles.length > 0) {
		await reencodeDirtyTiles(documentId, dirtyTiles, layerIds);
	}

	const tileImages: TileImageEntry[] = [];
	for (const tile of tiles) {
		for (const layerId of layerIds) {
			const record = await db.tilePixels.get(
				tilePixelsRecordId(documentId, tile.x, tile.y, layerId)
			);
			if (record?.webpCache) {
				tileImages.push({ x: tile.x, y: tile.y, layerId, webp: new Uint8Array(record.webpCache) });
			}
		}
	}

	const textures: TextureEntry[] = [];
	if (doc.background.type === 'texture' && doc.background.textureId) {
		const textureRecord = await db.textures.get(doc.background.textureId);
		if (textureRecord) {
			const webp = new Uint8Array(await textureRecord.blob.arrayBuffer());
			textures.push({ id: doc.background.textureId, webp });
		}
	}

	const manifest = toManifest(doc, layers, tiles);
	const bytes = packContainer({ manifest, tiles: tileImages, textures });

	const fileName =
		kind === 'manual' ? opfs.manualSaveFileName(doc.title) : opfs.autosaveFileName(doc.title);
	await opfs.writeDocumentFile(documentId, fileName, bytes);

	if (dirtyTiles.length > 0) {
		await db.tiles.bulkPut(dirtyTiles.map((tile) => ({ ...tile, dirty: false })));
	}
}

/**
 * 주기적으로 dirty 타일이 있는지 확인해 있을 때만 자동 저장한다.
 * setInterval이 아니라 매 저장이 끝난 뒤 다음 타이머를 예약하는 방식이라, 저장이 간격보다
 * 오래 걸려도 겹쳐 실행되지 않는다. 반환하는 함수를 호출하면 루프를 멈춘다.
 */
export function startAutosaveLoop(
	getDocumentId: () => string | null,
	intervalMs: number
): () => void {
	let stopped = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

	async function tick(): Promise<void> {
		const documentId = getDocumentId();
		if (documentId) {
			try {
				const dirtyCount = await db.tiles
					.where('documentId')
					.equals(documentId)
					.filter((tile) => tile.dirty)
					.count();
				if (dirtyCount > 0) {
					await saveDocument(documentId, 'autosave');
				}
			} catch (err) {
				console.error('자동 저장 실패', err);
			}
		}
		if (!stopped) {
			timeoutHandle = setTimeout(tick, intervalMs);
		}
	}

	timeoutHandle = setTimeout(tick, intervalMs);

	return () => {
		stopped = true;
		if (timeoutHandle !== null) clearTimeout(timeoutHandle);
	};
}
