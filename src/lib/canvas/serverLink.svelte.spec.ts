import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './bootstrap';
import { CONTAINER_MIME_TYPE, packContainer, type ContainerManifest } from './container';
import { db } from './db';
import * as opfs from './opfs';
import {
	linkDocumentToServer,
	loadDocumentFromServer,
	startServerAutosaveLoop,
	syncDocumentToServer,
	unlinkDocumentFromServer
} from './serverLink';
import { tilePixelsRecordId, tileRecordId } from './types';

/**
 * "서버에 이미 저장돼 있던" 컨테이너를 흉내낸다. 진짜 다른 로컬 도큐먼트를 만들어 스냅샷 뜨면
 * 그 레이어 id가 이 브라우저의 다른 문서와 우연히 겹칠 일이 없는 실제 상황과 달리, 같은 테스트
 * 안에서 두 로컬 도큐먼트가 동시에 존재하게 되어 layers 테이블 기본키(id, 문서 간 전역 고유)가
 * 충돌해 버린다 — 그래서 레이어 id를 이 테스트 DB에 없는 새 UUID로 직접 만든 별도 매니페스트를
 * 쓴다(실제 원격 서버의 데이터는 애초에 이 브라우저의 다른 로컬 도큐먼트와 id가 겹칠 수 없다).
 */
function buildForeignContainerBytes(title: string): Uint8Array<ArrayBuffer> {
	const manifest: ContainerManifest = {
		formatVersion: 1,
		title,
		background: { type: 'color', color: '#ffffff' },
		layers: [
			{
				id: crypto.randomUUID(),
				name: 'Layer 1',
				mode: 'normal',
				opacity: 1,
				visible: true,
				order: 0
			}
		],
		tiles: [],
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
	return packContainer({ manifest, tiles: [], textures: [] });
}

describe('serverLink', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('링크 시 서버에 아직 아무것도 없으면(404) 지금 로컬 상태를 PUT하고 링크를 기록한다', async () => {
		const doc = await createDocument('링크 테스트');

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			if (!init || init.method === 'GET' || init.method === undefined) {
				return new Response(null, { status: 404 });
			}
			return new Response(null, { status: 200 });
		});

		const outcome = await linkDocumentToServer(
			doc.id,
			'https://example.invalid/my-doc',
			() => true
		);

		expect(outcome).toBe('pushed-local');
		const putCall = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PUT');
		expect(putCall).toBeDefined();
		expect(putCall?.[1]?.headers).toMatchObject({ 'Content-Type': CONTAINER_MIME_TYPE });

		const link = await db.documentLinks.get(doc.id);
		expect(link?.serverUrl).toBe('https://example.invalid/my-doc');

		fetchSpy.mockRestore();
	});

	it('링크 시 서버에 이미 캔버스가 있고 사용자가 승인하면, 그 내용으로 로컬을 교체한다', async () => {
		const localDoc = await createDocument('로컬 도큐먼트');
		const remoteBytes = buildForeignContainerBytes('원격 도큐먼트');

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			if (!init || init.method === 'GET' || init.method === undefined) {
				return new Response(remoteBytes, {
					status: 200,
					headers: { 'Content-Type': CONTAINER_MIME_TYPE }
				});
			}
			return new Response(null, { status: 200 });
		});

		const confirmFn = vi.fn().mockReturnValue(true);
		const outcome = await linkDocumentToServer(
			localDoc.id,
			'https://example.invalid/shared',
			confirmFn
		);

		expect(outcome).toBe('loaded-remote');
		expect(confirmFn).toHaveBeenCalledTimes(1);

		const updatedLocalDoc = await db.documents.get(localDoc.id);
		expect(updatedLocalDoc?.title).toBe('원격 도큐먼트');

		const link = await db.documentLinks.get(localDoc.id);
		expect(link?.serverUrl).toBe('https://example.invalid/shared');

		fetchSpy.mockRestore();
	});

	it('링크 시 서버에 이미 캔버스가 있지만 사용자가 거절하면, 링크도 로컬 변경도 일어나지 않는다', async () => {
		const localDoc = await createDocument('거절 테스트');
		const remoteBytes = buildForeignContainerBytes('다른 원격 도큐먼트');

		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response(remoteBytes, { status: 200, headers: { 'Content-Type': CONTAINER_MIME_TYPE } })
			);

		const outcome = await linkDocumentToServer(
			localDoc.id,
			'https://example.invalid/x',
			() => false
		);

		expect(outcome).toBe('cancelled');
		const updatedLocalDoc = await db.documents.get(localDoc.id);
		expect(updatedLocalDoc?.title).toBe('거절 테스트');
		expect(await db.documentLinks.get(localDoc.id)).toBeUndefined();

		fetchSpy.mockRestore();
	});

	it('unlinkDocumentFromServer는 로컬 링크 정보만 지운다', async () => {
		const doc = await createDocument('연결 해제 테스트');
		await db.documentLinks.put({ documentId: doc.id, serverUrl: 'https://x.invalid', linkedAt: 0 });

		await unlinkDocumentFromServer(doc.id);

		expect(await db.documentLinks.get(doc.id)).toBeUndefined();
	});

	it('loadDocumentFromServer는 서버에 아직 저장된 것이 없으면 false를 반환하고 로컬을 건드리지 않는다', async () => {
		const doc = await createDocument('불러오기 없음 테스트');
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 404 }));

		const loaded = await loadDocumentFromServer(doc.id, 'https://example.invalid/nope');

		expect(loaded).toBe(false);
		const stillLocal = await db.documents.get(doc.id);
		expect(stillLocal?.title).toBe('불러오기 없음 테스트');

		fetchSpy.mockRestore();
	});

	it('syncDocumentToServer는 스냅샷을 PUT으로 전송하고, 실패 응답이면 에러를 던진다', async () => {
		const doc = await createDocument('동기화 테스트');
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 500 }));

		await expect(syncDocumentToServer(doc.id, 'https://example.invalid/put')).rejects.toThrow(
			/500/
		);

		fetchSpy.mockRestore();
	});

	it('startServerAutosaveLoop은 dirty 타일이 있을 때만 PUT하고, 반환된 함수로 멈출 수 있다', async () => {
		const doc = await createDocument('서버 자동저장 루프 테스트');
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
			pixels: new ArrayBuffer(512 * 512 * 4),
			webpCache: null
		});

		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 200 }));

		const stop = startServerAutosaveLoop(
			() => ({ documentId: doc.id, url: 'https://example.invalid/auto' }),
			30
		);
		await new Promise((resolve) => setTimeout(resolve, 200));
		stop();

		expect(fetchSpy).toHaveBeenCalled();
		const tileAfter = await db.tiles.get(tileRecordId(doc.id, 0, 0));
		expect(tileAfter?.dirty).toBe(false);

		const callCountAtStop = fetchSpy.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(fetchSpy.mock.calls.length).toBe(callCountAtStop);

		fetchSpy.mockRestore();
	});

	it('startServerAutosaveLoop은 링크가 없으면(getLink가 null) 아무것도 하지 않는다', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const stop = startServerAutosaveLoop(() => null, 30);
		await new Promise((resolve) => setTimeout(resolve, 100));
		stop();

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
