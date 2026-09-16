/**
 * OPFS에 저장된 .infcanvas를 실제 로컬 파일로 내려받는다.
 * "서버와 링크하기"(자동저장/불러오기)는 serverLink.ts가 담당한다 — 이 파일은 순수 로컬
 * 다운로드만 다룬다.
 */
import { CONTAINER_MIME_TYPE } from './container';
import { db } from './db';
import * as opfs from './opfs';
import { saveDocument } from './persistence';

async function readLatestContainer(documentId: string): Promise<{ fileName: string; blob: Blob }> {
	const doc = await db.documents.get(documentId);
	if (!doc) throw new Error(`도큐먼트를 찾을 수 없습니다: ${documentId}`);

	await saveDocument(documentId, 'manual');

	const fileName = opfs.manualSaveFileName(doc.title);
	const bytes = await opfs.readDocumentFile(documentId, fileName);
	if (!bytes) throw new Error('내보낼 컨테이너 파일을 찾지 못했습니다.');

	return { fileName, blob: new Blob([bytes], { type: CONTAINER_MIME_TYPE }) };
}

/** OPFS에 저장된 .infcanvas를 실제 로컬 파일로 내려받는다. 가능하면 저장 위치 선택 대화상자를 쓴다 */
export async function downloadDocument(documentId: string): Promise<void> {
	const { fileName, blob } = await readLatestContainer(documentId);

	if (typeof window.showSaveFilePicker === 'function') {
		try {
			const handle = await window.showSaveFilePicker({
				suggestedName: fileName,
				types: [
					{
						description: 'Infinite Canvas 문서',
						accept: { [CONTAINER_MIME_TYPE]: ['.infcanvas'] }
					}
				]
			});
			const writable = await handle.createWritable();
			await writable.write(blob);
			await writable.close();
			return;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return; // 사용자가 취소함
			console.warn('showSaveFilePicker 실패, <a download>로 대체합니다.', err);
		}
	}

	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
