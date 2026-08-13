/**
 * 서버로 내보내기 위한 fetch 준비 + 로컬 디스크로의 다운로드.
 * 이 앱은 adapter-static(서버 없음)이므로 실제 백엔드는 포함하지 않는다 — 사용자가 지정한
 * 엔드포인트로 완성된 .infcanvas 컨테이너를 그대로 POST하는 클라이언트 쪽 호출만 준비해둔다.
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

/**
 * 최신 상태로 저장한 뒤, 완성된 .infcanvas 컨테이너를 지정한 엔드포인트로 POST한다.
 * 요청/응답 형식의 전체 스펙은 docs/api.md 참고.
 */
export async function exportDocumentToServer(
	documentId: string,
	endpointUrl: string
): Promise<Response> {
	const { fileName, blob } = await readLatestContainer(documentId);

	const response = await fetch(endpointUrl, {
		method: 'POST',
		headers: {
			'Content-Type': CONTAINER_MIME_TYPE,
			'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
		},
		body: blob
	});

	if (!response.ok) {
		throw new Error(`서버 내보내기 실패: HTTP ${response.status}`);
	}

	return response;
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
