import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { CONTAINER_FORMAT_VERSION, packContainer, unpackContainer } from './container';

describe('container', () => {
	it('mimetype 엔트리를 첫 번째, 무압축(STORE)으로 기록한다 (ODF/EPUB 매직 mimetype 관례)', () => {
		const bytes = packContainer({
			manifest: {
				formatVersion: CONTAINER_FORMAT_VERSION,
				title: 'Canvas',
				background: { type: 'color', color: '#ffffff' },
				layers: [],
				tiles: [],
				createdAt: 0,
				updatedAt: 0
			},
			tiles: [],
			textures: []
		});

		// zip local file header 레이아웃(첫 엔트리는 오프셋 0에서 시작):
		// 8-9=압축방식(0=STORE), 26-27=파일명 길이(n), 30..30+n=파일명
		const compressionMethod = bytes[8] | (bytes[9] << 8);
		const nameLength = bytes[26] | (bytes[27] << 8);
		const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));

		expect(name).toBe('mimetype');
		expect(compressionMethod).toBe(0);
	});

	it('pack -> unpack 라운드트립이 manifest/타일/텍스처를 그대로 보존한다', () => {
		const tileWebp = new Uint8Array([1, 2, 3, 4, 5]);
		const textureWebp = new Uint8Array([9, 9, 9]);

		const original = {
			manifest: {
				formatVersion: CONTAINER_FORMAT_VERSION,
				title: '내 그림',
				background: { type: 'texture' as const, color: '#ffffff', textureId: 'tex-1' },
				layers: [
					{
						id: 'layer-1',
						name: '레이어 1',
						mode: 'normal' as const,
						opacity: 1,
						visible: true,
						order: 0
					}
				],
				tiles: [{ x: -1, y: 2 }],
				createdAt: 111,
				updatedAt: 222
			},
			tiles: [{ x: -1, y: 2, layerId: 'layer-1', webp: tileWebp }],
			textures: [{ id: 'tex-1', webp: textureWebp }]
		};

		const unpacked = unpackContainer(packContainer(original));

		expect(unpacked.manifest).toEqual(original.manifest);
		expect(unpacked.tiles).toEqual(original.tiles);
		expect(unpacked.textures).toEqual(original.textures);
	});

	it('manifest.json이 없는 zip은 명확한 에러를 던진다', () => {
		const bogus = zipSync({ 'not-a-manifest.txt': strToU8('hello') });
		expect(() => unpackContainer(bogus)).toThrow();
	});
});
