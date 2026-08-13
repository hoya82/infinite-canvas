/**
 * 도큐먼트 컬렉션 전체를 다루는 CRUD — "현재 열려 있는 도큐먼트"만 아는 document.svelte.ts와
 * 달리, OPFS를 진실 공급원으로 삼아 아직 Dexie에 하이드레이션되지 않은 도큐먼트도 다룰 수 있다.
 * 파일명이 곧 제목(`{title}.infcanvas`)이므로, 목록 조회는 컨테이너를 열어보지 않고 디렉터리
 * 목록만으로 끝난다.
 */
import { packContainer, unpackContainer } from './container';
import { db } from './db';
import * as opfs from './opfs';

export interface DocumentSummary {
	id: string;
	title: string;
}

export async function listDocumentSummaries(): Promise<DocumentSummary[]> {
	const ids = await opfs.listDocumentIds();
	const summaries: DocumentSummary[] = [];

	for (const id of ids) {
		const fileName = await opfs.findManualSaveFileName(id);
		if (!fileName) continue; // 저장 전에 중단된 도큐먼트 등
		summaries.push({ id, title: fileName.slice(0, -'.infcanvas'.length) });
	}

	return summaries;
}

/**
 * 제목을 바꾼다. 픽셀은 건드리지 않고 컨테이너의 manifest.title만 고쳐서 새 파일명으로 다시 쓴다
 * (재인코딩이 필요 없다). 자동 저장 파일이 있으면 그것도 함께 옮긴다.
 */
export async function renameDocument(documentId: string, newTitle: string): Promise<void> {
	const trimmed = newTitle.trim();
	if (!trimmed) return;

	const oldFileName = await opfs.findManualSaveFileName(documentId);
	if (!oldFileName) return;
	const oldTitle = oldFileName.slice(0, -'.infcanvas'.length);
	if (oldTitle === trimmed) return;

	const manualBytes = await opfs.readDocumentFile(documentId, oldFileName);
	if (manualBytes) {
		const packed = unpackContainer(new Uint8Array(manualBytes));
		packed.manifest.title = trimmed;
		await opfs.writeDocumentFile(
			documentId,
			opfs.manualSaveFileName(trimmed),
			packContainer(packed)
		);
		await opfs.deleteDocumentFile(documentId, oldFileName);
	}

	const oldAutosaveName = opfs.autosaveFileName(oldTitle);
	const autosaveBytes = await opfs.readDocumentFile(documentId, oldAutosaveName);
	if (autosaveBytes) {
		const packed = unpackContainer(new Uint8Array(autosaveBytes));
		packed.manifest.title = trimmed;
		await opfs.writeDocumentFile(documentId, opfs.autosaveFileName(trimmed), packContainer(packed));
		await opfs.deleteDocumentFile(documentId, oldAutosaveName);
	}

	// 지금 Dexie 작업 영역에 하이드레이션되어 있는 도큐먼트라면 그 상태도 맞춰준다
	const openDoc = await db.documents.get(documentId);
	if (openDoc) {
		await db.documents.update(documentId, { title: trimmed });
	}
}

/** OPFS 컨테이너와 Dexie 작업 영역을 모두 정리한다 */
export async function deleteDocument(documentId: string): Promise<void> {
	await opfs.deleteDocumentDir(documentId);

	await db.transaction(
		'rw',
		db.documents,
		db.layers,
		db.tiles,
		db.tilePixels,
		db.textures,
		async () => {
			await db.documents.delete(documentId);
			await db.layers.where('documentId').equals(documentId).delete();
			await db.tiles.where('documentId').equals(documentId).delete();
			await db.tilePixels.where('documentId').equals(documentId).delete();
			await db.textures.where('documentId').equals(documentId).delete();
		}
	);
}
