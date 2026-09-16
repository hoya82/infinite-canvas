import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocument } from './bootstrap';
import { db } from './db';
import { downloadDocument } from './exportServer';
import * as opfs from './opfs';

describe('exportServer', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		for (const id of await opfs.listDocumentIds()) {
			await opfs.deleteDocumentDir(id);
		}
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
