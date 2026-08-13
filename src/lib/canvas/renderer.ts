/**
 * 뷰포트 + 타일 캐시 + 레이어 스택을 받아 메인 캔버스에 한 프레임을 그린다.
 *
 * 배경(색상/텍스처)을 화면 전체에 먼저 채운 뒤, 그 위에 실제로 존재하는(무언가 그려진) 타일만
 * 격자 좌표를 훑으며 레이어를 아래→위 순서로 직접 메인 캔버스에 그린다. 레이어를 캔버스에
 * 순서대로 그리면 Canvas2D의 globalCompositeOperation이 "지금까지 그려진 결과(배경 포함)"를
 * 대상으로 합성해주므로, 타일마다 별도의 오프스크린 컴포지트 캐시를 두지 않아도 Normal/Multiply
 * 블렌드가 정확히 맞는다. 렌더링은 매 프레임 루프가 아니라 입력이 있을 때만 호출된다(호출부 책임).
 *
 * DPR(디바이스 픽셀 비율) 스케일은 이 함수가 호출되기 전에 호출부가 `ctx.setTransform`으로
 * 미리 걸어둔다는 계약을 전제로 한다 — 이 함수는 save/restore로 그 기준 변환을 보존한 채
 * 그 위에 pan/zoom 변환만 얹는다.
 */
import type { TileStore } from './tileStore';
import { TILE_SIZE, type DocumentBackground, type Layer } from './types';
import type { Viewport } from './viewport.svelte';

/**
 * 인접한 두 타일을 각각 별도의 drawImage 호출로 그리면, 화면 좌표가 부동소수점이라 각 호출이
 * 래스터라이저에서 독립적으로 정수 디바이스 픽셀에 반올림되면서 경계에 1px 틈이 생길 수 있다
 * (그 틈으로 타일보다 먼저 그린 배경이 비쳐 보인다). 각 타일을 이 값만큼 살짝 더 크게 그려
 * 인접 타일끼리 미세하게 겹치게 해서 틈을 없앤다 — 내용물이 서브픽셀 단위로 확대되는 대가가
 * 있지만 육안으로는 구별되지 않는다.
 */
const TILE_SEAM_OVERLAP = 1;

export interface RenderInput {
	ctx: CanvasRenderingContext2D;
	viewport: Viewport;
	tileStore: TileStore;
	/** 아래(스택 하단)→위 순서로 정렬된 레이어 목록 */
	layers: readonly Layer[];
	background: DocumentBackground;
	/** background.type === 'texture'일 때 미리 로드해 둔 이미지. 없으면 배경색으로 대체한다 */
	backgroundTexture?: CanvasImageSource | null;
}

export function render(input: RenderInput): void {
	const { ctx, viewport } = input;
	ctx.save();
	ctx.clearRect(0, 0, viewport.width, viewport.height);

	drawBackground(input);
	drawTiles(input);

	ctx.restore();
}

function drawBackground(input: RenderInput): void {
	const { ctx, viewport, background, backgroundTexture } = input;

	if (background.type === 'texture' && backgroundTexture) {
		const pattern = ctx.createPattern(backgroundTexture, 'repeat');
		if (pattern) {
			ctx.save();
			ctx.translate(-viewport.panX * viewport.zoom, -viewport.panY * viewport.zoom);
			ctx.scale(viewport.zoom, viewport.zoom);
			ctx.fillStyle = pattern;
			ctx.fillRect(
				viewport.panX,
				viewport.panY,
				viewport.width / viewport.zoom,
				viewport.height / viewport.zoom
			);
			ctx.restore();
			return;
		}
	}

	ctx.fillStyle = background.color || '#ffffff';
	ctx.fillRect(0, 0, viewport.width, viewport.height);
}

function drawTiles(input: RenderInput): void {
	const { ctx, viewport, tileStore, layers } = input;
	const range = viewport.visibleTileRange();
	const visibleLayers = layers.filter((layer) => layer.visible);

	ctx.imageSmoothingEnabled = viewport.zoom < 1;

	for (let ty = range.minY; ty <= range.maxY; ty++) {
		for (let tx = range.minX; tx <= range.maxX; tx++) {
			if (!tileStore.hasTile(tx, ty)) continue;
			const loaded = tileStore.get(tx, ty);
			if (!loaded) continue; // 아직 비동기 로드 중이면 이번 프레임은 건너뛰고, 로드 완료 시 다시 그려진다

			const screenX = (tx * TILE_SIZE - viewport.panX) * viewport.zoom;
			const screenY = (ty * TILE_SIZE - viewport.panY) * viewport.zoom;
			const size = TILE_SIZE * viewport.zoom;

			for (const layer of visibleLayers) {
				const layerCanvas = loaded.layerCanvases.get(layer.id);
				if (!layerCanvas) continue;
				ctx.globalAlpha = layer.opacity;
				ctx.globalCompositeOperation = layer.mode === 'multiply' ? 'multiply' : 'source-over';
				ctx.drawImage(
					layerCanvas,
					screenX - TILE_SEAM_OVERLAP / 2,
					screenY - TILE_SEAM_OVERLAP / 2,
					size + TILE_SEAM_OVERLAP,
					size + TILE_SEAM_OVERLAP
				);
			}
		}
	}

	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-over';
}

/** 뷰포트(+마진)에 걸치는 좌표 중 실제로 존재하는 타일만 추려 tileStore.ensureLoaded에 넘길 목록을 만든다 */
export function collectVisibleExistingTiles(
	viewport: Viewport,
	tileStore: TileStore
): Array<{ x: number; y: number }> {
	const range = viewport.visibleTileRange();
	const coords: Array<{ x: number; y: number }> = [];
	for (let ty = range.minY; ty <= range.maxY; ty++) {
		for (let tx = range.minX; tx <= range.maxX; tx++) {
			if (tileStore.hasTile(tx, ty)) coords.push({ x: tx, y: ty });
		}
	}
	return coords;
}
