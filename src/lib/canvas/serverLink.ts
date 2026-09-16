/**
 * "서버와 링크하기" — GET/PUT 기반 저장·불러오기, 그리고 10분 간격 자동저장 루프.
 * 사용자가 입력한 URL 자체를 이 도큐먼트의 고유 리소스 주소로 쓴다: PUT으로 최신 스냅샷을
 * upsert하고, GET으로 그 경로에 마지막으로 저장된 스냅샷을 그대로 받아온다.
 * 전체 프로토콜은 docs/api.md 참고.
 */
import { hydrateDocumentFromBytes } from './bootstrap';
import { CONTAINER_MIME_TYPE } from './container';
import { buildContainerSnapshot } from './containerSnapshot';
import { db } from './db';

export const SERVER_AUTOSAVE_INTERVAL_MS = 10 * 60 * 1000;

/** 그 URL에 아직 아무것도 저장된 적이 없으면 null(오류가 아니라 "새로 링크함"의 신호) */
export async function fetchRemoteContainer(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
	const response = await fetch(url, { method: 'GET' });
	if (response.status === 404) return null;
	if (!response.ok) {
		throw new Error(`서버 불러오기 실패: HTTP ${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
}

async function pushContainerToServer(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
	const response = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': CONTAINER_MIME_TYPE },
		body: bytes
	});
	if (!response.ok) {
		throw new Error(`서버 저장 실패: HTTP ${response.status}`);
	}
}

/** 지금 이 순간의 도큐먼트를 스냅샷 떠서(그리기 논블로킹) 링크된 서버로 저장한다 */
export async function syncDocumentToServer(documentId: string, url: string): Promise<void> {
	const bytes = await buildContainerSnapshot(documentId);
	await pushContainerToServer(url, bytes);
}

export type LinkOutcome = 'loaded-remote' | 'pushed-local' | 'cancelled';

/**
 * 링크를 시도한다.
 * - 그 URL에 이미 저장된 캔버스가 있으면 confirmOverwriteLocal()로 물어보고, 승인하면 그
 *   컨테이너로 로컬 도큐먼트를 완전히 교체한다. 거절하면 링크를 아예 성립시키지 않는다 —
 *   "불러오지 않겠다"는 대답을 "내 로컬 내용으로 원격을 덮어써라"로 확대 해석하지 않는다.
 * - 없으면 지금 로컬 상태를 그 URL에 즉시 PUT해 링크를 확립한다.
 */
export async function linkDocumentToServer(
	documentId: string,
	url: string,
	confirmOverwriteLocal: () => boolean
): Promise<LinkOutcome> {
	const remoteBytes = await fetchRemoteContainer(url);

	if (remoteBytes) {
		if (!confirmOverwriteLocal()) return 'cancelled';
		await hydrateDocumentFromBytes(documentId, remoteBytes);
		await db.documentLinks.put({ documentId, serverUrl: url, linkedAt: Date.now() });
		return 'loaded-remote';
	}

	await syncDocumentToServer(documentId, url);
	await db.documentLinks.put({ documentId, serverUrl: url, linkedAt: Date.now() });
	return 'pushed-local';
}

/** 로컬 링크 정보만 지운다 — 서버에 저장된 데이터는 건드리지 않는다 */
export async function unlinkDocumentFromServer(documentId: string): Promise<void> {
	await db.documentLinks.delete(documentId);
}

/**
 * 링크된 상태에서 수동으로 서버 최신본을 다시 받아온다(로컬을 덮어쓴다).
 * 호출부가 미리 사용자에게 덮어쓰기를 확인받아야 한다. 서버에 아직 아무것도 없으면 false.
 */
export async function loadDocumentFromServer(documentId: string, url: string): Promise<boolean> {
	const remoteBytes = await fetchRemoteContainer(url);
	if (!remoteBytes) return false;
	await hydrateDocumentFromBytes(documentId, remoteBytes);
	return true;
}

/**
 * 링크되어 있는 동안 10분마다(그사이 변경이 있을 때만) 자동으로 서버에 저장한다.
 * persistence.ts의 startAutosaveLoop와 같은 자기예약형 setTimeout 패턴 — 저장이 간격보다
 * 오래 걸려도(네트워크 지연 포함) 겹쳐 실행되지 않는다.
 */
export function startServerAutosaveLoop(
	getLink: () => { documentId: string; url: string } | null,
	intervalMs: number = SERVER_AUTOSAVE_INTERVAL_MS
): () => void {
	let stopped = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

	async function tick(): Promise<void> {
		const link = getLink();
		if (link) {
			try {
				const dirtyCount = await db.tiles
					.where('documentId')
					.equals(link.documentId)
					.filter((tile) => tile.dirty)
					.count();
				if (dirtyCount > 0) {
					await syncDocumentToServer(link.documentId, link.url);
				}
			} catch (err) {
				console.error('서버 자동저장 실패', err);
			}
		}
		if (!stopped) {
			timeoutHandle = setTimeout(tick, intervalMs);
		}
	}

	timeoutHandle = setTimeout(tick, intervalMs);

	return () => {
		stopped = true;
		if (timeoutHandle !== null) clearTimeout(timeoutHandle);
	};
}
