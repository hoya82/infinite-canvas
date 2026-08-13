import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './bootstrap';
import { unpackContainer } from './container';
import { db } from './db';
import * as opfs from './opfs';
import { saveDocument, startAutosaveLoop } from './persistence';
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

describe('persistence', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('saveDocument(manual)는 dirty 타일만 재인코딩해 title.infcanvas에 기록하고 dirty를 지운다', async () => {
		const doc = await createDocument('저장 테스트');
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

		await saveDocument(doc.id, 'manual');

		const tileAfter = await db.tiles.get(tileRecordId(doc.id, 2, -1));
		expect(tileAfter?.dirty).toBe(false);

		const pixelsAfter = await db.tilePixels.get(tilePixelsRecordId(doc.id, 2, -1, layer.id));
		expect(pixelsAfter?.webpCache).not.toBeNull();

		const fileName = await opfs.findManualSaveFileName(doc.id);
		expect(fileName).toBe('저장 테스트.infcanvas');

		const bytes = await opfs.readDocumentFile(doc.id, fileName!);
		const { manifest, tiles } = unpackContainer(new Uint8Array(bytes!));
		expect(manifest.tiles).toEqual([{ x: 2, y: -1 }]);
		expect(tiles).toHaveLength(1);
		expect(tiles[0]).toMatchObject({ x: 2, y: -1, layerId: layer.id });
	});

	it('자동 저장은 별도 파일(.autosave-*)에 기록되고, 변경이 없으면 캐시를 재사용해 재인코딩하지 않는다', async () => {
		const doc = await createDocument('자동저장 테스트');
		const layer = (await db.layers.where('documentId').equals(doc.id).toArray())[0];

		await db.tiles.put({
			id: tileRecordId(doc.id, 0, 0),
			documentId: doc.id,
			x: 0,
			y: 0,
			dirty: true
		});
		await db.tilePixels.put({
			id: tilePixelsRecordId(doc.id, 0, 0, layer.id),
			documentId: doc.id,
			x: 0,
			y: 0,
			layerId: layer.id,
			pixels: makeSolidPixels(10, 20, 30, 255),
			webpCache: null
		});

		const encodeSpy = vi.spyOn(webpWorkerPool, 'encode');

		await saveDocument(doc.id, 'manual');
		expect(encodeSpy).toHaveBeenCalledTimes(1);

		// 추가 변경 없이 바로 자동 저장 — dirty가 없으므로 워커를 다시 호출하지 않고 캐시를 재사용해야 한다
		await saveDocument(doc.id, 'autosave');
		expect(encodeSpy).toHaveBeenCalledTimes(1);
		encodeSpy.mockRestore();

		const manualFile = await opfs.findManualSaveFileName(doc.id);
		const autosaveFile = opfs.autosaveFileName(doc.title);
		expect(manualFile).toBe('자동저장 테스트.infcanvas');
		expect(autosaveFile).toBe('.autosave-자동저장 테스트.infcanvas');

		const autosaveBytes = await opfs.readDocumentFile(doc.id, autosaveFile);
		expect(autosaveBytes).not.toBeNull();
	});

	it('startAutosaveLoop은 dirty 타일이 있을 때만 저장하고, 반환된 함수로 멈출 수 있다', async () => {
		const doc = await createDocument('루프 테스트');
		const layer = (await db.layers.where('documentId').equals(doc.id).toArray())[0];

		await db.tiles.put({
			id: tileRecordId(doc.id, 0, 0),
			documentId: doc.id,
			x: 0,
			y: 0,
			dirty: true
		});
		await db.tilePixels.put({
			id: tilePixelsRecordId(doc.id, 0, 0, layer.id),
			documentId: doc.id,
			x: 0,
			y: 0,
			layerId: layer.id,
			pixels: makeSolidPixels(1, 2, 3, 255),
			webpCache: null
		});

		const stop = startAutosaveLoop(() => doc.id, 30);
		await new Promise((resolve) => setTimeout(resolve, 200));
		stop();

		const tileAfter = await db.tiles.get(tileRecordId(doc.id, 0, 0));
		expect(tileAfter?.dirty).toBe(false);

		const autosaveFile = opfs.autosaveFileName(doc.title);
		const bytes = await opfs.readDocumentFile(doc.id, autosaveFile);
		expect(bytes).not.toBeNull();
	});
});
