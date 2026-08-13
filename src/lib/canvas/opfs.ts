/**
 * OPFS(Origin Private File System) 헬퍼.
 *
 * `navigator.storage.getDirectory()`는 File System Access API와 동일한
 * FileSystemDirectoryHandle/FileSystemFileHandle 인터페이스를 쓰지만, 권한 프롬프트 없이
 * 브라우저 오리진에 완전히 자동으로 저장된다 — "로그인 없이 마지막 도큐먼트 자동 로드"
 * 요구사항을 만족시키는 저장 방식으로 채택했다 (docs/tasks 참고).
 *
 * 도큐먼트별로 `documents/{documentId}/` 하위 디렉터리를 두어, 제목이 같은 두 도큐먼트가
 * 있어도 파일명이 겹치지 않게 한다. 그 안의 실제 파일명은 요구사항대로
 * `{title}.infcanvas`(수동 저장) / `.autosave-{title}.infcanvas`(자동 저장, dot 파일)를 따른다.
 */

const DOCUMENTS_DIR = 'documents';

function isNotFoundError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'NotFoundError';
}

/** 파일 시스템에서 의미가 있는 문자(경로 구분자 등)를 안전하게 치환한다 */
export function sanitizeFileNamePart(name: string): string {
	const trimmed = name.trim();
	const safe = trimmed.replace(/[\\/:*?"<>|]/g, '_');
	return safe.length > 0 ? safe : 'Untitled';
}

export function manualSaveFileName(title: string): string {
	return `${sanitizeFileNamePart(title)}.infcanvas`;
}

export function autosaveFileName(title: string): string {
	return `.autosave-${sanitizeFileNamePart(title)}.infcanvas`;
}

async function getRootDir(): Promise<FileSystemDirectoryHandle> {
	return navigator.storage.getDirectory();
}

async function getDocumentsDir(create = true): Promise<FileSystemDirectoryHandle> {
	const root = await getRootDir();
	return root.getDirectoryHandle(DOCUMENTS_DIR, { create });
}

async function getDocumentDir(
	documentId: string,
	create = false
): Promise<FileSystemDirectoryHandle | null> {
	try {
		const documentsDir = await getDocumentsDir(create);
		return await documentsDir.getDirectoryHandle(documentId, { create });
	} catch (err) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

/** 파일이 없으면 null을 반환한다 */
export async function readDocumentFile(
	documentId: string,
	fileName: string
): Promise<ArrayBuffer | null> {
	const dir = await getDocumentDir(documentId);
	if (!dir) return null;
	try {
		const fileHandle = await dir.getFileHandle(fileName);
		const file = await fileHandle.getFile();
		return await file.arrayBuffer();
	} catch (err) {
		if (isNotFoundError(err)) return null;
		throw err;
	}
}

export async function writeDocumentFile(
	documentId: string,
	fileName: string,
	data: BufferSource | Blob
): Promise<void> {
	const dir = await getDocumentDir(documentId, true);
	if (!dir) throw new Error(`문서 디렉터리를 생성하지 못했습니다: ${documentId}`);
	const fileHandle = await dir.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(data);
	await writable.close();
}

export async function deleteDocumentFile(documentId: string, fileName: string): Promise<void> {
	const dir = await getDocumentDir(documentId);
	if (!dir) return;
	try {
		await dir.removeEntry(fileName);
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}
}

/** 도큐먼트 삭제 시 해당 디렉터리(수동/자동 저장 파일 전부) 통째로 제거 */
export async function deleteDocumentDir(documentId: string): Promise<void> {
	const documentsDir = await getDocumentsDir(false).catch((err) => {
		if (isNotFoundError(err)) return null;
		throw err;
	});
	if (!documentsDir) return;
	try {
		await documentsDir.removeEntry(documentId, { recursive: true });
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
	}
}

/** OPFS에 실제로 디렉터리가 존재하는 모든 도큐먼트 id 목록 */
export async function listDocumentIds(): Promise<string[]> {
	const documentsDir = await getDocumentsDir(true);
	const ids: string[] = [];
	for await (const [name, handle] of documentsDir.entries()) {
		if (handle.kind === 'directory') ids.push(name);
	}
	return ids;
}

/** 도큐먼트 디렉터리 안의 파일명 목록 (수동 저장/자동 저장 파일 포함) */
export async function listDocumentFileNames(documentId: string): Promise<string[]> {
	const dir = await getDocumentDir(documentId);
	if (!dir) return [];
	const names: string[] = [];
	for await (const [name, handle] of dir.entries()) {
		if (handle.kind === 'file') names.push(name);
	}
	return names;
}

/**
 * 도큐먼트 디렉터리에서 수동 저장 파일(dot 파일이 아닌 `*.infcanvas`)명을 찾는다.
 * 파일명이 곧 제목이므로(`{title}.infcanvas`), 이를 통해 Dexie 없이도 OPFS만으로 제목을 복원할 수 있다.
 */
export async function findManualSaveFileName(documentId: string): Promise<string | null> {
	const names = await listDocumentFileNames(documentId);
	return names.find((name) => !name.startsWith('.') && name.endsWith('.infcanvas')) ?? null;
}
