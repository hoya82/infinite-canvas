import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import * as opfs from './opfs';
import { documentState } from './document.svelte';

describe('DocumentState 레이어 CRUD', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
		await documentState.load();
	});

	it('addLayer는 스택 맨 위에 새 레이어를 추가하고 활성 레이어로 선택한다', async () => {
		const before = documentState.layers.length;
		const layer = await documentState.addLayer('새 레이어');

		expect(documentState.layers).toHaveLength(before + 1);
		expect(documentState.orderedLayers.at(-1)?.id).toBe(layer.id);
		expect(documentState.activeLayerId).toBe(layer.id);

		const stored = await db.layers.get(layer.id);
		expect(stored?.name).toBe('새 레이어');
	});

	it('removeLayer는 마지막 남은 한 장은 지우지 않는다', async () => {
		expect(documentState.layers).toHaveLength(1);
		const onlyLayerId = documentState.layers[0].id;

		await documentState.removeLayer(onlyLayerId);

		expect(documentState.layers).toHaveLength(1);
	});

	it('removeLayer는 활성 레이어를 지우면 다른 레이어(스택 최상단)로 활성 레이어를 옮긴다', async () => {
		const second = await documentState.addLayer('두번째');
		expect(documentState.activeLayerId).toBe(second.id);

		await documentState.removeLayer(second.id);

		expect(documentState.layers).toHaveLength(1);
		expect(documentState.activeLayerId).toBe(documentState.layers[0].id);
	});

	it('setLayerOpacity는 0~1 범위로 값을 clamp한다', async () => {
		const layerId = documentState.layers[0].id;

		await documentState.setLayerOpacity(layerId, 1.5);
		expect(documentState.layers.find((l) => l.id === layerId)?.opacity).toBe(1);

		await documentState.setLayerOpacity(layerId, -0.5);
		expect(documentState.layers.find((l) => l.id === layerId)?.opacity).toBe(0);
	});

	it('setLayerMode/renameLayer/setLayerVisible은 상태와 Dexie를 함께 갱신한다', async () => {
		const layerId = documentState.layers[0].id;

		await documentState.setLayerMode(layerId, 'multiply');
		await documentState.renameLayer(layerId, '  배경  ');
		await documentState.setLayerVisible(layerId, false);

		const inMemory = documentState.layers.find((l) => l.id === layerId);
		expect(inMemory?.mode).toBe('multiply');
		expect(inMemory?.name).toBe('배경'); // 앞뒤 공백은 trim된다
		expect(inMemory?.visible).toBe(false);

		const stored = await db.layers.get(layerId);
		expect(stored?.mode).toBe('multiply');
		expect(stored?.name).toBe('배경');
		expect(stored?.visible).toBe(false);
	});

	it('moveLayer는 인접한 레이어와 order를 맞바꾸고, 경계에서는 아무 일도 하지 않는다', async () => {
		const bottom = documentState.layers[0];
		const top = await documentState.addLayer('위 레이어');

		expect(documentState.orderedLayers.map((l) => l.id)).toEqual([bottom.id, top.id]);

		await documentState.moveLayer(bottom.id, 'up');
		expect(documentState.orderedLayers.map((l) => l.id)).toEqual([top.id, bottom.id]);

		// 이미 맨 위인 레이어를 더 위로 올리려 하면 순서가 그대로다
		await documentState.moveLayer(bottom.id, 'up');
		expect(documentState.orderedLayers.map((l) => l.id)).toEqual([top.id, bottom.id]);

		await documentState.moveLayer(bottom.id, 'down');
		expect(documentState.orderedLayers.map((l) => l.id)).toEqual([bottom.id, top.id]);
	});
});
