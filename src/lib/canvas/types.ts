/** 타일 한 변의 픽셀 크기 (정사각형, 고정) */
export const TILE_SIZE = 512;

export type LayerMode = 'normal' | 'multiply';

export interface Layer {
	id: string;
	documentId: string;
	name: string;
	mode: LayerMode;
	/** 0(완전 투명) ~ 1(완전 불투명) */
	opacity: number;
	visible: boolean;
	/** 스택 내 순서. 값이 클수록 위(상단) 레이어 */
	order: number;
}

export type BackgroundType = 'color' | 'texture';

export interface DocumentBackground {
	type: BackgroundType;
	/** CSS 색상 문자열. 기본값 흰색(#ffffff) */
	color: string;
	/** type이 'texture'일 때 textures 테이블을 참조하는 id */
	textureId?: string;
}

export interface CanvasDocument {
	id: string;
	title: string;
	background: DocumentBackground;
	createdAt: number;
	updatedAt: number;
}

export interface TileCoord {
	x: number;
	y: number;
}

/**
 * 타일 존재 여부와 dirty 플래그만 담는 레코드.
 * 실제 픽셀 데이터는 TilePixelsRecord(레이어별)에 분리 저장한다.
 */
export interface TileRecord {
	/** `${documentId}:${x}:${y}` */
	id: string;
	documentId: string;
	x: number;
	y: number;
	/** 마지막 컨테이너 저장 이후 변경되었는지 여부 */
	dirty: boolean;
}

/** 타일 하나의 레이어 하나에 대한 원본(비압축) 픽셀 버퍼 */
export interface TilePixelsRecord {
	/** `${documentId}:${x}:${y}:${layerId}` */
	id: string;
	documentId: string;
	x: number;
	y: number;
	layerId: string;
	/** RGBA8, TILE_SIZE * TILE_SIZE * 4 bytes */
	pixels: ArrayBuffer;
	/**
	 * 현재 pixels를 마지막으로 인코딩한 결과 webp 바이트 캐시.
	 * pixels가 바뀌면(브러시로 그림) null로 무효화되고, 저장(M5)에서 해당 타일이 dirty일 때만
	 * 다시 인코딩해 채운다 — 수동 저장과 자동 저장이 같은 캐시를 공유하므로 둘 중 하나가 이미
	 * 인코딩해 두었으면 나머지 하나는 재인코딩 없이 그대로 재사용한다.
	 */
	webpCache: ArrayBuffer | null;
}

/** 도큐먼트 배경으로 쓰이는 커스텀 seamless 텍스처 */
export interface TextureRecord {
	id: string;
	documentId: string;
	blob: Blob;
}

/** 단일 행 설정 테이블 (마지막으로 연 도큐먼트 등) */
export interface AppStateRecord {
	id: 'singleton';
	lastOpenedDocumentId: string | null;
}

export type Tool = 'brush' | 'eraser' | 'eyedropper';

export interface ToolSettings {
	tool: Tool;
	brushSize: number;
	eraserSize: number;
	/** 전경색, hex (#rrggbb) */
	color: string;
}

export function generateId(): string {
	return crypto.randomUUID();
}

export function tileRecordId(documentId: string, x: number, y: number): string {
	return `${documentId}:${x}:${y}`;
}

export function tilePixelsRecordId(
	documentId: string,
	x: number,
	y: number,
	layerId: string
): string {
	return `${documentId}:${x}:${y}:${layerId}`;
}
