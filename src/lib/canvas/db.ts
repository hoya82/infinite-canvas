import Dexie, { type EntityTable } from 'dexie';
import type {
	AppStateRecord,
	CanvasDocument,
	Layer,
	TextureRecord,
	TilePixelsRecord,
	TileRecord
} from './types';

/** appState 테이블은 항상 이 id를 가진 단일 행만 존재한다 */
export const APP_STATE_ID = 'singleton' as const;

/**
 * 현재 열려 있는 도큐먼트의 "언팩된" 작업 영역.
 * OPFS의 .infcanvas 컨테이너는 여기로 압축 해제되어 편집되고, 저장 시 다시 컨테이너로 묶인다.
 */
export const db = new Dexie('infinite-canvas') as Dexie & {
	documents: EntityTable<CanvasDocument, 'id'>;
	layers: EntityTable<Layer, 'id'>;
	tiles: EntityTable<TileRecord, 'id'>;
	tilePixels: EntityTable<TilePixelsRecord, 'id'>;
	textures: EntityTable<TextureRecord, 'id'>;
	appState: EntityTable<AppStateRecord, 'id'>;
};

// tiles.dirty는 IndexedDB의 유효한 키 타입이 아니므로(boolean은 인덱스 키로 쓸 수 없다 — 실측:
// dexieBooleanIndex.svelte.spec.ts) [documentId+dirty] 같은 복합 인덱스에 넣지 않는다.
// documentId로만 걸러낸 뒤 dirty는 Collection.filter()로 JS에서 거른다.
db.version(1).stores({
	documents: 'id, updatedAt',
	layers: 'id, documentId, [documentId+order]',
	tiles: 'id, documentId',
	tilePixels: 'id, documentId, [documentId+layerId]',
	textures: 'id, documentId',
	appState: 'id'
});
