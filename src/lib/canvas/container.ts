import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { BackgroundType, LayerMode } from './types';

/**
 * .infcanvas 컨테이너 = zip.
 *
 * ODF/EPUB과 동일한 "매직 mimetype" 관례를 따른다: 첫 번째 엔트리로 이름이 정확히
 * `mimetype`이고 무압축(STORE)인 파일을 두어, 압축 해제 없이도 파일 종류를 식별할 수 있게 한다.
 * 그 외 모든 엔트리도 STORE(level: 0)로 기록한다 — 내용물(webp, json)이 이미 압축되어 있어
 * deflate를 건너뛰는 편이 순수한 속도 이득이며, "압축률보다 빠른 저장" 요구사항에 맞는다.
 */
export const CONTAINER_MIME_TYPE = 'application/vnd.infcanvas+zip';
export const CONTAINER_FORMAT_VERSION = 1;

export interface ManifestLayer {
	id: string;
	name: string;
	mode: LayerMode;
	opacity: number;
	visible: boolean;
	order: number;
}

export interface ManifestBackground {
	type: BackgroundType;
	color: string;
	textureId?: string;
}

export interface ContainerManifest {
	formatVersion: number;
	title: string;
	background: ManifestBackground;
	layers: ManifestLayer[];
	/** 컨테이너에 존재하는 타일 좌표 목록 (실제 픽셀 유무와 무관하게 인덱스 역할) */
	tiles: Array<{ x: number; y: number }>;
	createdAt: number;
	updatedAt: number;
}

export interface TileImageEntry {
	x: number;
	y: number;
	layerId: string;
	webp: Uint8Array<ArrayBuffer>;
}

export interface TextureEntry {
	id: string;
	webp: Uint8Array<ArrayBuffer>;
}

export interface PackedContainer {
	manifest: ContainerManifest;
	tiles: TileImageEntry[];
	textures: TextureEntry[];
}

const TILE_PATH_RE = /^tiles\/(-?\d+)_(-?\d+)\/([^/]+)\.webp$/;
const TEXTURE_PATH_RE = /^textures\/([^/]+)\.webp$/;

function tileEntryPath(x: number, y: number, layerId: string): string {
	return `tiles/${x}_${y}/${layerId}.webp`;
}

function textureEntryPath(id: string): string {
	return `textures/${id}.webp`;
}

export function packContainer(data: PackedContainer): Uint8Array<ArrayBuffer> {
	// 프로퍼티 삽입 순서가 zip 엔트리 순서가 되므로 mimetype을 반드시 첫 번째로 넣는다.
	const files: Zippable = {
		mimetype: [strToU8(CONTAINER_MIME_TYPE), { level: 0 }]
	};

	files['manifest.json'] = [strToU8(JSON.stringify(data.manifest)), { level: 0 }];

	for (const tile of data.tiles) {
		files[tileEntryPath(tile.x, tile.y, tile.layerId)] = [tile.webp, { level: 0 }];
	}
	for (const texture of data.textures) {
		files[textureEntryPath(texture.id)] = [texture.webp, { level: 0 }];
	}

	return zipSync(files);
}

export function unpackContainer(bytes: Uint8Array): PackedContainer {
	const files = unzipSync(bytes);

	const manifestBytes = files['manifest.json'];
	if (!manifestBytes) {
		throw new Error('잘못된 .infcanvas 파일입니다: manifest.json이 없습니다.');
	}
	const manifest = JSON.parse(strFromU8(manifestBytes)) as ContainerManifest;

	const tiles: TileImageEntry[] = [];
	const textures: TextureEntry[] = [];

	for (const [path, content] of Object.entries(files)) {
		const tileMatch = TILE_PATH_RE.exec(path);
		if (tileMatch) {
			tiles.push({
				x: Number(tileMatch[1]),
				y: Number(tileMatch[2]),
				layerId: tileMatch[3],
				webp: content
			});
			continue;
		}
		const textureMatch = TEXTURE_PATH_RE.exec(path);
		if (textureMatch) {
			textures.push({ id: textureMatch[1], webp: content });
		}
	}

	return { manifest, tiles, textures };
}
