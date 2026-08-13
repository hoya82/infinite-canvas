/**
 * 앱 시작 시 부트스트랩: 마지막으로 연 도큐먼트를 OPFS에서 찾아 Dexie(작업 영역)로
 * 하이드레이션하고, 아무것도 없으면(최초 실행) "Canvas" 타이틀의 빈 도큐먼트를 만든다.
 * 단일 사용자 모드이므로 로그인/선택 화면 없이 항상 문서 하나를 반환한다.
 */
import { APP_STATE_ID, db } from './db';
import {
	CONTAINER_FORMAT_VERSION,
	packContainer,
	unpackContainer,
	type ContainerManifest,
	type TextureEntry,
	type TileImageEntry
} from './container';
import * as opfs from './opfs';
import {
	generateId,
	tilePixelsRecordId,
	tileRecordId,
	TILE_SIZE,
	type CanvasDocument,
	type Layer,
	type TilePixelsRecord,
	type TileRecord
} from './types';
import { webpBlobToRawPixels } from './webpCodec';

const DEFAULT_DOCUMENT_TITLE = 'Canvas';

function defaultLayer(documentId: string): Layer {
	return {
		id: generateId(),
		documentId,
		name: '레이어 1',
		mode: 'normal',
		opacity: 1,
		visible: true,
		order: 0
	};
}

function toManifest(
	doc: CanvasDocument,
	layers: Layer[],
	tiles: Array<{ x: number; y: number }>
): ContainerManifest {
	return {
		formatVersion: CONTAINER_FORMAT_VERSION,
		title: doc.title,
		background: doc.background,
		layers: layers
			.slice()
			.sort((a, b) => a.order - b.order)
			.map((layer) => ({
				id: layer.id,
				name: layer.name,
				mode: layer.mode,
				opacity: layer.opacity,
				visible: layer.visible,
				order: layer.order
			})),
		tiles,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt
	};
}

/** 새 도큐먼트를 만들어 Dexie에 기록하고, 빈 컨테이너를 OPFS에도 즉시 저장한다 */
export async function createDocument(title: string): Promise<CanvasDocument> {
	const now = Date.now();
	const doc: CanvasDocument = {
		id: generateId(),
		title,
		background: { type: 'color', color: '#ffffff' },
		createdAt: now,
		updatedAt: now
	};
	const layer = defaultLayer(doc.id);

	await db.transaction('rw', db.documents, db.layers, async () => {
		await db.documents.add(doc);
		await db.layers.add(layer);
	});

	const manifest = toManifest(doc, [layer], []);
	const bytes = packContainer({ manifest, tiles: [], textures: [] });
	await opfs.writeDocumentFile(doc.id, opfs.manualSaveFileName(doc.title), bytes);

	return doc;
}

async function hydrateTilesFromContainer(
	documentId: string,
	tileImages: TileImageEntry[]
): Promise<void> {
	const grouped = new Map<string, TileImageEntry[]>();
	for (const entry of tileImages) {
		const key = `${entry.x}:${entry.y}`;
		const list = grouped.get(key);
		if (list) list.push(entry);
		else grouped.set(key, [entry]);
	}

	const tileRecords: TileRecord[] = [];
	const pixelRecords: TilePixelsRecord[] = [];

	for (const [key, entries] of grouped) {
		const [xStr, yStr] = key.split(':');
		const x = Number(xStr);
		const y = Number(yStr);
		tileRecords.push({ id: tileRecordId(documentId, x, y), documentId, x, y, dirty: false });

		for (const entry of entries) {
			const pixels = await webpBlobToRawPixels(new Blob([entry.webp]), TILE_SIZE);
			pixelRecords.push({
				id: tilePixelsRecordId(documentId, x, y, entry.layerId),
				documentId,
				x,
				y,
				layerId: entry.layerId,
				pixels,
				webpCache: entry.webp.slice().buffer
			});
		}
	}

	await db.transaction('rw', db.tiles, db.tilePixels, async () => {
		await db.tiles.where('documentId').equals(documentId).delete();
		await db.tilePixels.where('documentId').equals(documentId).delete();
		if (tileRecords.length > 0) await db.tiles.bulkAdd(tileRecords);
		if (pixelRecords.length > 0) await db.tilePixels.bulkAdd(pixelRecords);
	});
}

async function hydrateTexturesFromContainer(
	documentId: string,
	textures: TextureEntry[]
): Promise<void> {
	await db.transaction('rw', db.textures, async () => {
		await db.textures.where('documentId').equals(documentId).delete();
		for (const texture of textures) {
			await db.textures.put({
				id: texture.id,
				documentId,
				blob: new Blob([texture.webp], { type: 'image/webp' })
			});
		}
	});
}

/** OPFS의 수동 저장 컨테이너를 읽어 Dexie 작업 영역으로 완전히 복원한다 */
export async function hydrateDocumentFromOpfs(documentId: string): Promise<CanvasDocument> {
	const fileName = await opfs.findManualSaveFileName(documentId);
	if (!fileName) {
		throw new Error(`저장된 .infcanvas 컨테이너를 찾을 수 없습니다: ${documentId}`);
	}
	const bytes = await opfs.readDocumentFile(documentId, fileName);
	if (!bytes) {
		throw new Error(`컨테이너 파일을 읽지 못했습니다: ${documentId}/${fileName}`);
	}

	const { manifest, tiles, textures } = unpackContainer(new Uint8Array(bytes));

	const doc: CanvasDocument = {
		id: documentId,
		title: manifest.title,
		background: manifest.background,
		createdAt: manifest.createdAt,
		updatedAt: manifest.updatedAt
	};
	const layers: Layer[] = manifest.layers.map((layer) => ({ ...layer, documentId }));

	await db.transaction('rw', db.documents, db.layers, async () => {
		await db.documents.put(doc);
		await db.layers.where('documentId').equals(documentId).delete();
		if (layers.length > 0) await db.layers.bulkAdd(layers);
	});

	await hydrateTilesFromContainer(documentId, tiles);
	await hydrateTexturesFromContainer(documentId, textures);

	return doc;
}

/**
 * 앱 시작 시 1회 호출. 열어야 할 도큐먼트를 결정해 Dexie 작업 영역까지 준비를 마친 뒤 반환한다.
 * 우선순위: 마지막으로 연 도큐먼트 → (없어졌다면) OPFS에 남아있는 아무 도큐먼트 → 없으면 새로 생성.
 */
export async function ensureBootstrapped(): Promise<CanvasDocument> {
	const appState = await db.appState.get(APP_STATE_ID);
	const existingIds = await opfs.listDocumentIds();

	const lastId = appState?.lastOpenedDocumentId ?? null;
	if (lastId && existingIds.includes(lastId)) {
		const doc = await hydrateDocumentFromOpfs(lastId);
		return doc;
	}

	if (existingIds.length > 0) {
		const doc = await hydrateDocumentFromOpfs(existingIds[0]);
		await db.appState.put({ id: APP_STATE_ID, lastOpenedDocumentId: doc.id });
		return doc;
	}

	const doc = await createDocument(DEFAULT_DOCUMENT_TITLE);
	await db.appState.put({ id: APP_STATE_ID, lastOpenedDocumentId: doc.id });
	return doc;
}
