import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';

/**
 * IndexedDB의 유효한 키 타입에는 boolean이 없다(문자열/숫자/날짜/바이너리/배열만 가능).
 * 처음에는 tiles 테이블에 [documentId+dirty] 복합 인덱스(dirty: boolean)를 두었는데, 그
 * 인덱스로 쿼리하면 DataError가 나는 것을 실측하고 db.ts에서 제거했다 — 대신 documentId
 * 인덱스로만 좁힌 뒤 dirty는 Collection.filter()로 JS에서 거른다. 회귀 방지를 위해 두 가지를
 * 모두 남겨둔다: 깨지는 방식이 실제로 깨진다는 것과, 고친 방식이 동작한다는 것.
 */
describe('Dexie와 boolean 필드', () => {
	it('boolean을 복합 인덱스 키로 쿼리하면 IndexedDB가 DataError를 던진다 (db.ts에서 이 패턴을 뺀 이유)', async () => {
		// EntityTable의 타입 추론이 이 임시 스키마의 복합 키를 제대로 못 잡아내므로, 여기서는
		// 일부러 느슨하게 타입 지정된 Table을 그대로 쓴다(어차피 버리는 재현용 DB이다).
		const brokenDb = new Dexie('dexie-boolean-index-repro');
		brokenDb.version(1).stores({ rows: 'id, documentId, [documentId+dirty]' });
		const rows = brokenDb.table('rows');

		try {
			await rows.put({ id: 'r1', documentId: 'doc', dirty: true });
			// boolean은 애초에 유효한 IndexableType이 아니라서 타입 체크도 이를 거부한다 —
			// 바로 그 사실을 런타임으로 증명하려는 테스트이므로 여기서만 타입 단언으로 우회한다.
			await expect(
				rows
					.where('[documentId+dirty]')
					.equals(['doc', true] as unknown as string)
					.toArray()
			).rejects.toThrow(/not a valid key/i);
		} finally {
			await brokenDb.delete();
		}
	});

	describe('고친 방식: documentId 인덱스 + Collection.filter()', () => {
		beforeEach(async () => {
			await db.delete();
			await db.open();
		});
		afterEach(async () => {
			await db.delete();
			await db.open();
		});

		it('dirty(boolean) 조회가 정상 동작한다', async () => {
			await db.tiles.put({ id: 't:0:0', documentId: 'doc', x: 0, y: 0, dirty: true });
			await db.tiles.put({ id: 't:1:0', documentId: 'doc', x: 1, y: 0, dirty: false });
			await db.tiles.put({ id: 't:0:1', documentId: 'other-doc', x: 0, y: 1, dirty: true });

			const dirtyInDoc = await db.tiles
				.where('documentId')
				.equals('doc')
				.filter((tile) => tile.dirty)
				.toArray();

			expect(dirtyInDoc.map((tile) => tile.id)).toEqual(['t:0:0']);
		});
	});
});
