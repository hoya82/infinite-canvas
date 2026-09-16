import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './bootstrap';
import { unpackContainer } from './container';
import { buildContainerSnapshot } from './containerSnapshot';
import { db } from './db';
import * as opfs from './opfs';
import { TILE_SIZE, tilePixelsRecordId, tileRecordId } from './types';
import { webpWorkerPool } from './webpWorkerPool';

function makeSolidPixels(r: number, g: number, b: number, a: number): ArrayBuffer {
	const data = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = r;
		data[i + 1] = g;
		data[i + 2] = b;
		data[i + 3] = a;
	}
	return data.buffer;
}

describe('containerSnapshot', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('dirty 타일을 인코딩해 컨테이너를 만들고, dirty 플래그를 지운다', async () => {
		const doc = await createDocument('스냅샷 테스트');
		const layer = (await db.layers.where('documentId').equals(doc.id).toArray())[0];

		await db.tiles.put({
			id: tileRecordId(doc.id, 2, -1),
			documentId: doc.id,
			x: 2,
			y: -1,
			dirty: true
		});
		await db.tilePixels.put({
			id: tilePixelsRecordId(doc.id, 2, -1, layer.id),
			documentId: doc.id,
			x: 2,
			y: -1,
			layerId: layer.id,
			pixels: makeSolidPixels(200, 50, 10, 255),
			webpCache: null
		});

		const bytes = await buildContainerSnapshot(doc.id);

		const tileAfter = await db.tiles.get(tileRecordId(doc.id, 2, -1));
		expect(tileAfter?.dirty).toBe(false);
		const pixelsAfter = await db.tilePixels.get(tilePixelsRecordId(doc.id, 2, -1, layer.id));
		// 스냅샷 경로는 flushTouchedTiles/saveDocument와 동시에 도는 자동저장과의 경쟁을
		// 피하려고 일부러 tilePixels.webpCache에는 쓰지 않는다 — 인코딩 결과는 컨테이너 안에만 있다.
		expect(pixelsAfter?.webpCache).toBeNull();

		const { manifest, tiles } = unpackContainer(new Uint8Array(bytes));
		expect(manifest.title).toBe('스냅샷 테스트');
		expect(manifest.tiles).toEqual([{ x: 2, y: -1 }]);
		expect(tiles).toHaveLength(1);
		expect(tiles[0]).toMatchObject({ x: 2, y: -1, layerId: layer.id });
	});

	it('dirty가 아니고 webpCache가 있는 타일은 재인코딩하지 않고 캐시를 그대로 쓴다', async () => {
		const doc = await createDocument('캐시 재사용 테스트');
		const layer = (await db.layers.where('documentId').equals(doc.id).toArray())[0];

		await db.tiles.put({
			id: tileRecordId(doc.id, 0, 0),
			documentId: doc.id,
			x: 0,
			y: 0,
			dirty: false
		});
		await db.tilePixels.put({
			id: tilePixelsRecordId(doc.id, 0, 0, layer.id),
			documentId: doc.id,
			x: 0,
			y: 0,
			layerId: layer.id,
			pixels: makeSolidPixels(1, 2, 3, 255),
			webpCache: new ArrayBuffer(8)
		});

		const encodeSpy = vi.spyOn(webpWorkerPool, 'encode');
		const bytes = await buildContainerSnapshot(doc.id);
		expect(encodeSpy).not.toHaveBeenCalled();
		encodeSpy.mockRestore();

		const { tiles } = unpackContainer(new Uint8Array(bytes));
		expect(tiles).toHaveLength(1);
	});

	it('스냅샷 인코딩이 진행되는 동안(트랜잭션이 끝난 뒤) 같은 타일에 새로 그려진 내용은 유실되지 않는다', async () => {
		const doc = await createDocument('스냅샷 경쟁 테스트');
		const layer = (await db.layers.where('documentId').equals(doc.id).toArray())[0];
		const tileId = tileRecordId(doc.id, 0, 0);
		const pixelsId = tilePixelsRecordId(doc.id, 0, 0, layer.id);

		await db.tiles.put({ id: tileId, documentId: doc.id, x: 0, y: 0, dirty: true });
		await db.tilePixels.put({
			id: pixelsId,
			documentId: doc.id,
			x: 0,
			y: 0,
			layerId: layer.id,
			pixels: makeSolidPixels(10, 10, 10, 255),
			webpCache: null
		});

		let releaseEncode: (() => void) | null = null;
		const encodeSpy = vi.spyOn(webpWorkerPool, 'encode').mockImplementation(
			() =>
				new Promise((resolve) => {
					releaseEncode = () => resolve(new ArrayBuffer(4));
				})
		);

		const snapshotPromise = buildContainerSnapshot(doc.id);

		// 스냅샷의 Dexie 트랜잭션(dirty:false로 지우는 것까지 포함)은 이미 끝났고, 인코딩만 대기 중
		await vi.waitFor(() => expect(releaseEncode).not.toBeNull());
		const midTile = await db.tiles.get(tileId);
		expect(midTile?.dirty).toBe(false);

		// 바로 이 시점에 사용자가 같은 타일에 새 스트로크를 그렸다고 가정한다
		// (brushEngine.flushTouchedTiles가 하는 것과 동일한 트랜잭션)
		await db.transaction('rw', db.tiles, db.tilePixels, db.documents, async () => {
			await db.tiles.put({ id: tileId, documentId: doc.id, x: 0, y: 0, dirty: true });
			await db.tilePixels.put({
				id: pixelsId,
				documentId: doc.id,
				x: 0,
				y: 0,
				layerId: layer.id,
				pixels: makeSolidPixels(200, 0, 0, 255),
				webpCache: null
			});
		});

		releaseEncode!();
		await snapshotPromise;
		encodeSpy.mockRestore();

		// 스냅샷이 끝난 뒤에도 "그사이 그려진" 새 스트로크의 dirty는 그대로 남아 다음 자동저장
		// 사이클로 넘어간다 — 스냅샷이 잘못 지우지 않았다
		const tileAfter = await db.tiles.get(tileId);
		expect(tileAfter?.dirty).toBe(true);
		const pixelsAfter = await db.tilePixels.get(pixelsId);
		expect(new Uint8Array(pixelsAfter!.pixels)[0]).toBe(200);
	});
});
