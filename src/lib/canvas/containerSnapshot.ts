/**
 * 서버 자동저장/링크 저장을 위한 원자적 스냅샷.
 *
 * persistence.ts의 saveDocument()와 달리, "어떤 타일이 dirty인지 읽고 그 dirty 플래그를 지우는"
 * 작업을 하나의 Dexie 트랜잭션 안에서 끝낸다. 그 뒤에 이어지는 webp 인코딩과 서버 PUT은(느리고
 * 네트워크가 걸리므로 애초에 IndexedDB 트랜잭션 안에 넣을 수도 없다 — IDB 트랜잭션은 다른 종류의
 * 비동기 작업을 기다리는 동안 자동 커밋된다) 트랜잭션이 끝난 뒤, 트랜잭션 안에서 이미 복사해 둔
 * 픽셀 버퍼만 가지고 진행한다.
 *
 * 이렇게 분리해 두면 스냅샷 트랜잭션이 걸리는 아주 짧은 시간을 제외하고는 그리기(브러시 스트로크의
 * flushTouchedTiles)가 전혀 블로킹되지 않는다 — Dexie/IndexedDB가 같은 테이블에 걸친 두 rw
 * 트랜잭션을 항상 직렬화해 주므로, 스냅샷 도중/직후에 그려진 새 스트로크는 정확히 그 경계로 나뉘어
 * (스냅샷에 포함되거나, 다음 사이클로 넘어가거나) 유실되거나 dirty 플래그가 잘못 지워지는 일이
 * 없다.
 */
import {
	CONTAINER_FORMAT_VERSION,
	packContainer,
	type ContainerManifest,
	type TextureEntry,
	type TileImageEntry
} from './container';
import { db } from './db';
import { tilePixelsRecordId } from './types';
import { webpWorkerPool } from './webpWorkerPool';

interface PendingPixels {
	x: number;
	y: number;
	layerId: string;
	pixels: ArrayBuffer;
}

interface Snapshot {
	manifest: ContainerManifest;
	cachedTileImages: TileImageEntry[];
	pendingPixels: PendingPixels[];
	textures: TextureEntry[];
}

async function takeSnapshot(documentId: string): Promise<Snapshot> {
	return db.transaction(
		'rw',
		db.documents,
		db.layers,
		db.tiles,
		db.tilePixels,
		db.textures,
		async () => {
			const doc = await db.documents.get(documentId);
			if (!doc) throw new Error(`도큐먼트를 찾을 수 없습니다: ${documentId}`);

			const layers = await db.layers.where('documentId').equals(documentId).sortBy('order');
			const tiles = await db.tiles.where('documentId').equals(documentId).toArray();
			const dirtyTiles = tiles.filter((tile) => tile.dirty);
			const layerIds = layers.map((layer) => layer.id);

			const cachedTileImages: TileImageEntry[] = [];
			const pendingPixels: PendingPixels[] = [];

			for (const tile of tiles) {
				for (const layerId of layerIds) {
					const record = await db.tilePixels.get(
						tilePixelsRecordId(documentId, tile.x, tile.y, layerId)
					);
					if (!record) continue;
					// dirty이거나 캐시가 없으면(이례적) 지금 이 순간의 픽셀을 새로 인코딩해야 한다.
					// pixels는 IndexedDB에서 읽을 때 이미 독립된 복제본이라 그대로 넘겨도 안전하다.
					if (tile.dirty || !record.webpCache) {
						pendingPixels.push({ x: tile.x, y: tile.y, layerId, pixels: record.pixels });
					} else {
						cachedTileImages.push({
							x: tile.x,
							y: tile.y,
							layerId,
							webp: new Uint8Array(record.webpCache)
						});
					}
				}
			}

			// 이 트랜잭션이 "본" dirty 상태만 지운다 — 이후(트랜잭션 밖) 인코딩/전송 도중 새로
			// 그려진 스트로크의 flushTouchedTiles 트랜잭션은 이 트랜잭션과 직렬화되어 항상 그 뒤에
			// 적용되므로, 그 스트로크의 dirty:true가 여기서 지워질 일은 없다.
			if (dirtyTiles.length > 0) {
				await db.tiles.bulkPut(dirtyTiles.map((tile) => ({ ...tile, dirty: false })));
			}

			const textures: TextureEntry[] = [];
			if (doc.background.type === 'texture' && doc.background.textureId) {
				const textureRecord = await db.textures.get(doc.background.textureId);
				if (textureRecord) {
					textures.push({
						id: doc.background.textureId,
						webp: new Uint8Array(await textureRecord.blob.arrayBuffer())
					});
				}
			}

			const manifest: ContainerManifest = {
				formatVersion: CONTAINER_FORMAT_VERSION,
				title: doc.title,
				background: doc.background,
				layers: layers.map((layer) => ({
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

			return { manifest, cachedTileImages, pendingPixels, textures };
		}
	);
}

/**
 * 지금 이 순간의 도큐먼트를 .infcanvas 바이트로 스냅샷한다. dirty 타일만 워커 풀로 재인코딩하고
 * (기존 webpCache는 그대로 재사용), 트랜잭션 밖에서 인코딩이 진행되므로 호출 도중에도 그리기는
 * 막히지 않는다.
 */
export async function buildContainerSnapshot(documentId: string): Promise<Uint8Array<ArrayBuffer>> {
	const snapshot = await takeSnapshot(documentId);

	const freshlyEncoded = await Promise.all(
		snapshot.pendingPixels.map(async ({ x, y, layerId, pixels }) => ({
			x,
			y,
			layerId,
			webp: new Uint8Array(await webpWorkerPool.encode(pixels.slice(0)))
		}))
	);

	return packContainer({
		manifest: snapshot.manifest,
		tiles: [...snapshot.cachedTileImages, ...freshlyEncoded],
		textures: snapshot.textures
	});
}
