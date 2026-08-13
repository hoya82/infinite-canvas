import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from './types';
import { Viewport } from './viewport.svelte';

function makeViewport(width: number, height: number): Viewport {
	const viewport = new Viewport();
	viewport.width = width;
	viewport.height = height;
	return viewport;
}

describe('Viewport', () => {
	it('screenToWorld와 worldToScreen은 서로 역함수다', () => {
		const viewport = makeViewport(800, 600);
		viewport.panX = 123;
		viewport.panY = -45;
		viewport.zoom = 2;

		const world = viewport.screenToWorld(100, 200);
		const backToScreen = viewport.worldToScreen(world.x, world.y);

		expect(backToScreen.x).toBeCloseTo(100);
		expect(backToScreen.y).toBeCloseTo(200);
	});

	it('panByScreenDelta는 화면 델타를 줌으로 나눈 만큼 반대 방향으로 pan을 이동시킨다', () => {
		const viewport = makeViewport(800, 600);
		viewport.zoom = 2;

		viewport.panByScreenDelta(20, -10);

		expect(viewport.panX).toBeCloseTo(-10); // 오른쪽으로 드래그하면 월드는 왼쪽으로 이동
		expect(viewport.panY).toBeCloseTo(5);
	});

	it('zoomAt은 앵커 지점의 월드 좌표를 확대/축소 후에도 고정한다', () => {
		const viewport = makeViewport(800, 600);
		viewport.panX = 50;
		viewport.panY = 50;
		viewport.zoom = 1;

		const before = viewport.screenToWorld(400, 300);
		viewport.zoomAt(400, 300, 2);
		const after = viewport.screenToWorld(400, 300);

		expect(viewport.zoom).toBeCloseTo(2);
		expect(after.x).toBeCloseTo(before.x);
		expect(after.y).toBeCloseTo(before.y);
	});

	it('zoomAt은 줌 배율을 [0.05, 32] 범위로 제한한다', () => {
		const viewport = makeViewport(800, 600);
		viewport.zoomAt(0, 0, 0.0001);
		expect(viewport.zoom).toBeGreaterThanOrEqual(0.05);

		viewport.zoomAt(0, 0, 1000);
		expect(viewport.zoom).toBeLessThanOrEqual(32);
	});

	it('visibleTileRange는 뷰포트 경계를 타일 격자로 변환하고 마진을 더한다', () => {
		const viewport = makeViewport(TILE_SIZE * 2, TILE_SIZE * 2);
		viewport.panX = 0;
		viewport.panY = 0;
		viewport.zoom = 1;

		const range = viewport.visibleTileRange(1);

		// 화면에 (0,0)~(1024,1024) 월드가 보이므로 타일 0,1이 딱 걸치고, 마진 1을 더하면 -1..2
		expect(range.minX).toBe(-1);
		expect(range.maxX).toBe(2);
		expect(range.minY).toBe(-1);
		expect(range.maxY).toBe(2);
	});

	it('visibleTileRange는 음수 좌표 영역에서도 올바르게 동작한다', () => {
		const viewport = makeViewport(TILE_SIZE, TILE_SIZE);
		viewport.panX = -TILE_SIZE * 1.5;
		viewport.panY = -TILE_SIZE * 1.5;
		viewport.zoom = 1;

		const range = viewport.visibleTileRange(0);

		expect(range.minX).toBe(-2);
		expect(range.maxX).toBe(-1);
		expect(range.minY).toBe(-2);
		expect(range.maxY).toBe(-1);
	});
});
