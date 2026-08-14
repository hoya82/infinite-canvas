import { describe, expect, it } from 'vitest';
import {
	angleRadToHue,
	barycentricToPoint,
	barycentricToSv,
	cartesianToBarycentric,
	closestPointInTriangle,
	getWheelGeometry,
	hueToAngleRad,
	pointOnRing,
	svToBarycentric,
	triangleVertices,
	type Point
} from './colorWheel';

describe('hueToAngleRad / angleRadToHue', () => {
	it('서로 역함수다 (왕복 변환)', () => {
		for (const hue of [0, 45, 90, 180, 270, 359]) {
			expect(angleRadToHue(hueToAngleRad(hue))).toBeCloseTo(hue, 5);
		}
	});

	it('hue=0은 12시 방향(위쪽, -y)을 가리킨다', () => {
		const angle = hueToAngleRad(0);
		expect(Math.cos(angle)).toBeCloseTo(0, 5);
		expect(Math.sin(angle)).toBeCloseTo(-1, 5);
	});
});

describe('getWheelGeometry / pointOnRing', () => {
	const geo = getWheelGeometry(200, 24, 6);

	it('중심과 반지름을 올바르게 계산한다', () => {
		expect(geo.center).toEqual({ x: 100, y: 100 });
		expect(geo.outerRadius).toBe(100);
		expect(geo.innerRadius).toBe(76);
		expect(geo.triangleRadius).toBe(70);
	});

	it('링 위의 점은 중심에서 (outer+inner)/2 거리에 있다', () => {
		const p = pointOnRing(geo, 90);
		const dist = Math.hypot(p.x - geo.center.x, p.y - geo.center.y);
		expect(dist).toBeCloseTo((geo.outerRadius + geo.innerRadius) / 2, 5);
	});
});

describe('triangleVertices', () => {
	const geo = getWheelGeometry(200, 24, 6);

	it('세 꼭짓점 모두 중심에서 triangleRadius만큼 떨어져 있고 120도씩 벌어져 있다', () => {
		const { hue, white, black } = triangleVertices(geo, 30);
		for (const v of [hue, white, black]) {
			const dist = Math.hypot(v.x - geo.center.x, v.y - geo.center.y);
			expect(dist).toBeCloseTo(geo.triangleRadius, 5);
		}
	});

	it('hue 꼭짓점은 링의 hue 각도와 같은 방향을 가리킨다', () => {
		const hueAngle = 200;
		const { hue } = triangleVertices(geo, hueAngle);
		const ring = pointOnRing(geo, hueAngle);
		const triAngle = Math.atan2(hue.y - geo.center.y, hue.x - geo.center.x);
		const ringAngle = Math.atan2(ring.y - geo.center.y, ring.x - geo.center.x);
		expect(triAngle).toBeCloseTo(ringAngle, 5);
	});
});

describe('svToBarycentric / barycentricToSv', () => {
	it('서로 역함수다 (왕복 변환, value=0인 검정 근처는 saturation이 정의되지 않아 제외)', () => {
		const samples: Array<[number, number]> = [
			[0, 0],
			[100, 100],
			[0, 100],
			[50, 50],
			[37, 82]
		];
		for (const [s, v] of samples) {
			const bary = svToBarycentric(s, v);
			const roundTripped = barycentricToSv(bary);
			expect(roundTripped.saturation).toBeCloseTo(s, 5);
			expect(roundTripped.value).toBeCloseTo(v, 5);
		}
	});

	it('value=0(검은색)이면 saturation 값과 무관하게 무게가 전부 검은색 꼭짓점에 쏠린다', () => {
		const bary = svToBarycentric(80, 0);
		expect(bary.w).toBeCloseTo(1, 5);
		expect(bary.u).toBeCloseTo(0, 5);
		expect(bary.v).toBeCloseTo(0, 5);
	});

	it('u+v+w는 항상 1이다', () => {
		for (const s of [0, 25, 50, 75, 100]) {
			for (const v of [0, 25, 50, 75, 100]) {
				const bary = svToBarycentric(s, v);
				expect(bary.u + bary.v + bary.w).toBeCloseTo(1, 10);
			}
		}
	});
});

describe('cartesianToBarycentric / barycentricToPoint', () => {
	const geo = getWheelGeometry(200, 24, 6);
	const { hue: a, white: b, black: c } = triangleVertices(geo, 120);

	it('무게중심좌표 <-> 좌표 왕복 변환이 원래 점을 보존한다', () => {
		const bary = svToBarycentric(64, 41);
		const p = barycentricToPoint(bary, a, b, c);
		const roundTripped = cartesianToBarycentric(p, a, b, c);
		expect(roundTripped.u).toBeCloseTo(bary.u, 5);
		expect(roundTripped.v).toBeCloseTo(bary.v, 5);
		expect(roundTripped.w).toBeCloseTo(bary.w, 5);
	});

	it('꼭짓점 자체는 무게 1과 0으로 분해된다', () => {
		expect(cartesianToBarycentric(a, a, b, c).u).toBeCloseTo(1, 5);
		expect(cartesianToBarycentric(b, a, b, c).v).toBeCloseTo(1, 5);
		expect(cartesianToBarycentric(c, a, b, c).w).toBeCloseTo(1, 5);
	});
});

describe('closestPointInTriangle', () => {
	const a: Point = { x: 0, y: -10 };
	const b: Point = { x: -10, y: 5 };
	const c: Point = { x: 10, y: 5 };

	it('삼각형 내부의 점은 그대로 반환한다', () => {
		const inside: Point = { x: 0, y: 0 };
		const result = closestPointInTriangle(inside, a, b, c);
		expect(result.x).toBeCloseTo(inside.x, 5);
		expect(result.y).toBeCloseTo(inside.y, 5);
	});

	it('꼭짓점 근처(그 꼭짓점의 보로노이 영역) 바깥 점은 해당 꼭짓점으로 클램프된다', () => {
		const farBeyondA: Point = { x: 0, y: -100 };
		const result = closestPointInTriangle(farBeyondA, a, b, c);
		expect(result.x).toBeCloseTo(a.x, 5);
		expect(result.y).toBeCloseTo(a.y, 5);
	});

	it('한 변 바깥의 점은 그 변 위로 클램프된다 (변에 수직으로 벗어난 경우)', () => {
		// b-c 변은 y=5 수평선. 그 아래(바깥)에서 변의 중점 쪽으로 곧장 벗어난 점.
		const belowBc: Point = { x: 0, y: 50 };
		const result = closestPointInTriangle(belowBc, a, b, c);
		expect(result.y).toBeCloseTo(5, 5);
		expect(result.x).toBeCloseTo(0, 5);
	});

	it('클램프된 점의 무게중심좌표는 항상 음수가 없다 (삼각형 내부/경계)', () => {
		const outside: Point = { x: 200, y: -300 };
		const clamped = closestPointInTriangle(outside, a, b, c);
		const bary = cartesianToBarycentric(clamped, a, b, c);
		expect(bary.u).toBeGreaterThanOrEqual(-1e-9);
		expect(bary.v).toBeGreaterThanOrEqual(-1e-9);
		expect(bary.w).toBeGreaterThanOrEqual(-1e-9);
	});
});
