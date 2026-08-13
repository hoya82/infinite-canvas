import { beforeEach, describe, expect, it } from 'vitest';
import { APP_STATE_ID, db } from './db';
import * as opfs from './opfs';
import { createDocument, ensureBootstrapped, hydrateDocumentFromOpfs } from './bootstrap';

describe('bootstrap', () => {
	beforeEach(async () => {
		// 각 테스트가 서로 영향을 주지 않도록 Dexie/OPFS를 깨끗한 상태로 초기화한다.
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('최초 실행 시 "Canvas" 타이틀의 빈 도큐먼트를 자동 생성한다', async () => {
		const doc = await ensureBootstrapped();
		expect(doc.title).toBe('Canvas');

		const layers = await db.layers.where('documentId').equals(doc.id).toArray();
		expect(layers).toHaveLength(1);
		expect(layers[0].mode).toBe('normal');
		expect(layers[0].opacity).toBe(1);

		const tiles = await db.tiles.where('documentId').equals(doc.id).toArray();
		expect(tiles).toHaveLength(0);

		const appState = await db.appState.get(APP_STATE_ID);
		expect(appState?.lastOpenedDocumentId).toBe(doc.id);
	});

	it('두 번째 호출부터는 마지막으로 연 도큐먼트를 다시 열 뿐 중복 생성하지 않는다', async () => {
		const first = await ensureBootstrapped();
		const second = await ensureBootstrapped();

		expect(second.id).toBe(first.id);
		const allDocs = await db.documents.toArray();
		expect(allDocs).toHaveLength(1);
	});

	it('createDocument는 OPFS에 즉시 컨테이너를 기록하고, Dexie 없이도 다시 하이드레이션할 수 있다', async () => {
		const doc = await createDocument('테스트 문서');

		const fileName = await opfs.findManualSaveFileName(doc.id);
		expect(fileName).toBe('테스트 문서.infcanvas');

		// Dexie 작업 영역을 지워서 OPFS 컨테이너만으로 복원되는지 검증한다.
		await db.documents.delete(doc.id);
		await db.layers.where('documentId').equals(doc.id).delete();

		const hydrated = await hydrateDocumentFromOpfs(doc.id);
		expect(hydrated.title).toBe('테스트 문서');
		expect(hydrated.background).toEqual({ type: 'color', color: '#ffffff' });

		const layers = await db.layers.where('documentId').equals(doc.id).toArray();
		expect(layers).toHaveLength(1);
		expect(layers[0].name).toBe('레이어 1');
	});
});
