/**
 * 뷰포트(카메라) 상태: 화면 좌상단이 가리키는 월드 좌표(panX, panY)와 배율(zoom).
 * world 좌표계는 도큐먼트 픽셀 단위이며, 타일은 TILE_SIZE(512) 간격의 정수 격자에 놓인다.
 */
import { TILE_SIZE } from './types';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

export class Viewport {
	panX = $state(0);
	panY = $state(0);
	zoom = $state(1);
	/** 렌더링 대상 캔버스의 CSS 픽셀 크기 (렌더러가 매 프레임 갱신) */
	width = $state(0);
	height = $state(0);

	screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
		return { x: this.panX + screenX / this.zoom, y: this.panY + screenY / this.zoom };
	}

	worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
		return { x: (worldX - this.panX) * this.zoom, y: (worldY - this.panY) * this.zoom };
	}

	/** 화면 픽셀 델타만큼 패닝한다 (화면상 드래그 방향과 반대로 월드가 움직여야 자연스럽다) */
	panByScreenDelta(dxScreen: number, dyScreen: number): void {
		this.panX -= dxScreen / this.zoom;
		this.panY -= dyScreen / this.zoom;
	}

	/** 화면상의 한 점(anchorScreenX, anchorScreenY)이 확대/축소 후에도 같은 월드 좌표를 가리키도록 줌을 적용한다 */
	zoomAt(anchorScreenX: number, anchorScreenY: number, factor: number): void {
		const before = this.screenToWorld(anchorScreenX, anchorScreenY);
		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
		const after = this.screenToWorld(anchorScreenX, anchorScreenY);
		this.panX += before.x - after.x;
		this.panY += before.y - after.y;
	}

	/** 현재 뷰포트(+ 프리페치 마진 1타일)에 걸치는 타일 좌표 범위 */
	visibleTileRange(marginTiles = 1): { minX: number; maxX: number; minY: number; maxY: number } {
		const left = this.panX;
		const top = this.panY;
		const right = this.panX + this.width / this.zoom;
		const bottom = this.panY + this.height / this.zoom;

		// right/bottom은 배타적 경계이므로, 걸치는 타일의 "포함" 최대 인덱스는 ceil(...) - 1이다
		// (경계가 정확히 타일 격자선과 겹칠 때 한 칸 더 포함되는 것을 방지)
		return {
			minX: Math.floor(left / TILE_SIZE) - marginTiles,
			maxX: Math.ceil(right / TILE_SIZE) - 1 + marginTiles,
			minY: Math.floor(top / TILE_SIZE) - marginTiles,
			maxY: Math.ceil(bottom / TILE_SIZE) - 1 + marginTiles
		};
	}

	/** 현재 뷰포트 정중앙이 가리키는 월드(픽셀) 좌표 */
	centerWorld(): { x: number; y: number } {
		return this.screenToWorld(this.width / 2, this.height / 2);
	}

	/** 줌은 그대로 두고, 화면 정중앙이 주어진 월드 좌표를 가리키도록 pan만 옮긴다 */
	panCenterTo(worldX: number, worldY: number): void {
		const center = this.centerWorld();
		this.panX += worldX - center.x;
		this.panY += worldY - center.y;
	}

	/** 줌을 [MIN_ZOOM, MAX_ZOOM]로 clamp해 세팅한 뒤, 화면 정중앙이 그 월드 좌표를 가리키게 이동한다 */
	jumpTo(worldX: number, worldY: number, zoom: number): void {
		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
		this.panCenterTo(worldX, worldY);
	}
}

/**
 * 지금 마운트되어 있는 CanvasStage의 Viewport 인스턴스를 다른 컴포넌트(레이어 패널 위
 * 좌표 표시줄 등)에서도 읽을 수 있게 하는 공유 홀더. 도큐먼트 전환 시 CanvasStage가
 * 통째로 재마운트되며 Viewport도 새로 만들어지므로(뷰가 기본값으로 리셋되는 기존 동작을
 * 유지하기 위해 진짜 싱글턴으로 만들지 않는다), CanvasStage가 마운트/언마운트될 때마다
 * 이 holder의 `current`를 등록/해제한다.
 */
class ViewportHolder {
	current = $state<Viewport | null>(null);
}

export const activeViewport = new ViewportHolder();
