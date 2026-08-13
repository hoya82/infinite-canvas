import { beforeEach, describe, expect, it } from 'vitest';
import { createDocument, hydrateDocumentFromOpfs } from './bootstrap';
import { unpackContainer } from './container';
import { db } from './db';
import { deleteDocument, listDocumentSummaries, renameDocument } from './documentManager';
import * as opfs from './opfs';

describe('documentManager', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('listDocumentSummaries는 OPFS에 저장된 모든 도큐먼트를 파일명만으로(컨테이너를 열지 않고) 나열한다', async () => {
		const a = await createDocument('첫번째');
		const b = await createDocument('두번째');

		const summaries = await listDocumentSummaries();

		expect(summaries).toEqual(
			expect.arrayContaining([
				{ id: a.id, title: '첫번째' },
				{ id: b.id, title: '두번째' }
			])
		);
		expect(summaries).toHaveLength(2);
	});

	it('renameDocument는 재인코딩 없이 파일명과 manifest.title만 바꾼다 (Dexie에 열려있지 않아도 동작)', async () => {
		const doc = await createDocument('원래 이름');
		// 일부러 Dexie에서 지워서 "지금 열려있지 않은 도큐먼트"를 재현한다
		await db.documents.delete(doc.id);

		await renameDocument(doc.id, '새 이름');

		expect(await opfs.findManualSaveFileName(doc.id)).toBe('새 이름.infcanvas');
		const bytes = await opfs.readDocumentFile(doc.id, '새 이름.infcanvas');
		const { manifest } = unpackContainer(new Uint8Array(bytes!));
		expect(manifest.title).toBe('새 이름');

		// 다시 열어도 새 이름으로 정상 하이드레이션된다
		const reopened = await hydrateDocumentFromOpfs(doc.id);
		expect(reopened.title).toBe('새 이름');
	});

	it('renameDocument는 현재 Dexie에 열려있는 도큐먼트라면 그 상태도 함께 갱신한다', async () => {
		const doc = await createDocument('A');
		await renameDocument(doc.id, 'B');

		const stored = await db.documents.get(doc.id);
		expect(stored?.title).toBe('B');
	});

	it('deleteDocument는 OPFS 컨테이너와 Dexie 작업 영역을 모두 지운다', async () => {
		const doc = await createDocument('지울 문서');
		expect(await opfs.listDocumentIds()).toContain(doc.id);

		await deleteDocument(doc.id);

		expect(await opfs.listDocumentIds()).not.toContain(doc.id);
		expect(await db.documents.get(doc.id)).toBeUndefined();
		expect(await db.layers.where('documentId').equals(doc.id).count()).toBe(0);
	});
});
