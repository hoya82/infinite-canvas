import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './bootstrap';
import { CONTAINER_MIME_TYPE, unpackContainer } from './container';
import { db } from './db';
import { downloadDocument, exportDocumentToServer } from './exportServer';
import * as opfs from './opfs';
import { tilePixelsRecordId, tileRecordId } from './types';

describe('exportServer', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
	});

	it('exportDocumentToServer는 최신 상태로 저장한 뒤 완성된 컨테이너를 지정한 엔드포인트로 POST한다', async () => {
		const doc = await createDocument('내보내기 테스트');
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

		const response = await exportDocumentToServer(doc.id, 'https://example.invalid/upload');

		expect(response.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://example.invalid/upload');
		expect(init?.method).toBe('POST');
		expect(init?.headers).toMatchObject({ 'Content-Type': CONTAINER_MIME_TYPE });
		expect(init?.body).toBeInstanceOf(Blob);

		// 저장이 실제로 일어났는지(dirty가 지워졌는지) 함께 확인한다
		const tileAfter = await db.tiles.get(tileRecordId(doc.id, 0, 0));
		expect(tileAfter?.dirty).toBe(false);

		const bytes = await (init!.body as Blob).arrayBuffer();
		const { manifest } = unpackContainer(new Uint8Array(bytes));
		expect(manifest.title).toBe('내보내기 테스트');

		fetchSpy.mockRestore();
	});

	it('exportDocumentToServer는 서버가 실패 응답(4xx/5xx)을 주면 에러를 던진다', async () => {
		const doc = await createDocument('실패 테스트');

		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(null, { status: 500 }));

		await expect(exportDocumentToServer(doc.id, 'https://example.invalid/upload')).rejects.toThrow(
			/500/
		);

		fetchSpy.mockRestore();
	});

	it('downloadDocument는 showSaveFilePicker가 없으면 <a download>로 대체한다', async () => {
		const doc = await createDocument('다운로드 테스트');

		// 헤드리스 Chromium에도 showSaveFilePicker 자체는 존재하므로(실측), 이 테스트에서는
		// 없는 환경을 흉내내기 위해 명시적으로 지운다 — 실제로 호출하면 네이티브 대화상자를
		// 띄우려다 헤드리스에서 멈춰버린다.
		const original = window.showSaveFilePicker;
		delete window.showSaveFilePicker;

		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');

		try {
			await downloadDocument(doc.id);

			expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
			expect(clickSpy).toHaveBeenCalledTimes(1);
			const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
			expect(anchor.download).toBe('다운로드 테스트.infcanvas');
			expect(anchor.href).toBe('blob:mock-url');
		} finally {
			clickSpy.mockRestore();
			createObjectUrlSpy.mockRestore();
			window.showSaveFilePicker = original;
		}
	});

	it('downloadDocument는 showSaveFilePicker가 있으면 그 경로로 파일을 쓰고 <a download>는 쓰지 않는다', async () => {
		const doc = await createDocument('네이티브 저장 테스트');

		let written: Blob | null = null;
		const fakeHandle = {
			createWritable: async () => ({
				write: async (data: Blob) => {
					written = data;
				},
				close: async () => {}
			})
		};
		const pickerSpy = vi.fn().mockResolvedValue(fakeHandle as unknown as FileSystemFileHandle);
		const original = window.showSaveFilePicker;
		window.showSaveFilePicker = pickerSpy;
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

		try {
			await downloadDocument(doc.id);

			expect(pickerSpy).toHaveBeenCalledWith(
				expect.objectContaining({ suggestedName: '네이티브 저장 테스트.infcanvas' })
			);
			expect(written).not.toBeNull();
			expect(clickSpy).not.toHaveBeenCalled();
		} finally {
			clickSpy.mockRestore();
			window.showSaveFilePicker = original;
		}
	});
});
