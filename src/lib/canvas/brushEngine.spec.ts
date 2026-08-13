import { describe, expect, it } from 'vitest';
import { accumulateStamps, INITIAL_STAMP_STATE, pressureToRadius } from './brushEngine';

describe('pressureToRadius', () => {
	it('마우스는 필압 센서가 없으므로 항상 최대 굵기(반경 = size/2)를 사용한다', () => {
		expect(pressureToRadius(40, 0.01, 'mouse')).toBeCloseTo(20);
		expect(pressureToRadius(40, 1, 'mouse')).toBeCloseTo(20);
	});

	it('펜은 필압에 비례해 최소 20% ~ 100% 사이로 반경이 변한다', () => {
		const full = pressureToRadius(40, 1, 'pen');
		const light = pressureToRadius(40, 0, 'pen');
		expect(full).toBeCloseTo(20);
		expect(light).toBeCloseTo(40 / 2 / 5); // minFactor 0.2
	});

	it('반경은 최소 0.5px 아래로 내려가지 않는다', () => {
		expect(pressureToRadius(0.1, 0, 'pen')).toBeGreaterThanOrEqual(0.5);
	});
});

describe('accumulateStamps', () => {
	it('첫 포인트는 그대로 스탬프 하나를 방출하며 스트로크를 시작한다', () => {
		const state = accumulateStamps(INITIAL_STAMP_STATE, { worldX: 10, worldY: 20, pressure: 1 }, 5);
		expect(state.started).toBe(true);
		expect(state.pendingStamps).toEqual([{ worldX: 10, worldY: 20, pressure: 1 }]);
	});

	it('간격보다 가까운 움직임은 새 스탬프를 만들지 않되, 마지막 "스탬프된" 위치를 기준으로 계속 누적된다', () => {
		// 3px씩 세 번 움직이면 총 9px로 아직 spacing(10px) 미만이라 스탬프가 없어야 하고,
		// 기준점이 매번 "직전 포인터 위치"로 갱신돼버리면(잘못된 구현) 느린 마우스 움직임에서는
		// 영원히 스탬프가 하나도 안 찍히는 버그가 생긴다 — 기준점은 마지막 스탬프 위치에 고정돼야 한다.
		let state = accumulateStamps(INITIAL_STAMP_STATE, { worldX: 0, worldY: 0, pressure: 1 }, 10);
		state = accumulateStamps(state, { worldX: 3, worldY: 0, pressure: 1 }, 10);
		expect(state.pendingStamps).toEqual([]);
		state = accumulateStamps(state, { worldX: 6, worldY: 0, pressure: 1 }, 10);
		expect(state.pendingStamps).toEqual([]);
		state = accumulateStamps(state, { worldX: 11, worldY: 0, pressure: 1 }, 10);
		expect(state.pendingStamps).toHaveLength(1);
		expect(state.pendingStamps[0].worldX).toBeCloseTo(10);
	});

	it('간격보다 먼 움직임은 경로를 따라 균등한 간격으로 여러 스탬프를 보간한다', () => {
		const first = accumulateStamps(INITIAL_STAMP_STATE, { worldX: 0, worldY: 0, pressure: 1 }, 10);
		const second = accumulateStamps(first, { worldX: 25, worldY: 0, pressure: 1 }, 10);

		expect(second.pendingStamps).toHaveLength(2); // 10, 20 지점 (25는 다음 세그먼트로 남음)
		expect(second.pendingStamps[0].worldX).toBeCloseTo(10);
		expect(second.pendingStamps[1].worldX).toBeCloseTo(20);
		expect(second.lastX).toBe(25); // 다음 세그먼트를 위해 실제 포인터 위치로 갱신
	});

	it('타일 경계를 넘나드는 대각선 이동도 spacing 간격을 유지한다 (seamless 스트로크의 전제)', () => {
		const first = accumulateStamps(
			INITIAL_STAMP_STATE,
			{ worldX: 500, worldY: 500, pressure: 1 },
			8
		);
		const second = accumulateStamps(first, { worldX: 540, worldY: 540, pressure: 1 }, 8);

		for (let i = 1; i < second.pendingStamps.length; i++) {
			const a = second.pendingStamps[i - 1];
			const b = second.pendingStamps[i];
			const dist = Math.hypot(b.worldX - a.worldX, b.worldY - a.worldY);
			expect(dist).toBeCloseTo(8, 5);
		}
	});
});
