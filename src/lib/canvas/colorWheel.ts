/**
 * Krita 스타일 "링(Hue) + 삼각형(Saturation/Value)" 컬러 휠의 기하 계산과 캔버스 렌더링.
 *
 * 삼각형의 세 꼭짓점(순색 A, 흰색 B, 검은색 C)에 대한 무게중심좌표(u,v,w)는 항상 u+v+w=1을
 * 만족하는 아핀 파라미터인데, HSV의 표준 정의(S=U/(U+V), V=U+V, U=chroma)를 대입해 전개하면
 * "세 꼭짓점 색을 무게중심좌표로 RGB 채널별 선형 보간"한 결과가 정확히 올바른 HSV 삼각형
 * 그라디언트와 일치한다(우연이 아니라 HSV가 이 파라미터화에 대해 아핀이기 때문). 그 덕분에
 * per-pixel RGB 선형 블렌드만으로 정확한 채도/명도 그라디언트를 그릴 수 있다.
 */
import { hsbToRgb, type RGB } from './color';

export interface Point {
	x: number;
	y: number;
}

export interface WheelGeometry {
	size: number;
	center: Point;
	outerRadius: number;
	innerRadius: number;
	triangleRadius: number;
}

export interface Barycentric {
	/** 순색(hue) 꼭짓점 가중치 */
	u: number;
	/** 흰색 꼭짓점 가중치 */
	v: number;
	/** 검은색 꼭짓점 가중치 */
	w: number;
}

export interface TriangleVertices {
	hue: Point;
	white: Point;
	black: Point;
}

export function getWheelGeometry(
	size: number,
	ringThickness: number,
	triangleGap: number
): WheelGeometry {
	const outerRadius = size / 2;
	const innerRadius = outerRadius - ringThickness;
	return {
		size,
		center: { x: size / 2, y: size / 2 },
		outerRadius,
		innerRadius,
		triangleRadius: innerRadius - triangleGap
	};
}

/** hue=0을 12시 방향에 두고, 각도가 커질수록(시계 방향) hue가 증가하도록 맞춘 변환 */
export function hueToAngleRad(hue: number): number {
	return ((hue - 90) * Math.PI) / 180;
}

export function angleRadToHue(angleRad: number): number {
	const deg = (angleRad * 180) / Math.PI + 90;
	return ((deg % 360) + 360) % 360;
}

export function pointOnRing(geo: WheelGeometry, hue: number): Point {
	const angle = hueToAngleRad(hue);
	const r = (geo.outerRadius + geo.innerRadius) / 2;
	return { x: geo.center.x + r * Math.cos(angle), y: geo.center.y + r * Math.sin(angle) };
}

/** 삼각형은 hue 꼭짓점이 링의 hue 각도를 가리키도록 링과 함께 회전하는 강체다 */
export function triangleVertices(geo: WheelGeometry, hue: number): TriangleVertices {
	const base = hueToAngleRad(hue);
	const r = geo.triangleRadius;
	const at = (angle: number): Point => ({
		x: geo.center.x + r * Math.cos(angle),
		y: geo.center.y + r * Math.sin(angle)
	});
	return {
		hue: at(base),
		white: at(base - (2 * Math.PI) / 3),
		black: at(base + (2 * Math.PI) / 3)
	};
}

export function cartesianToBarycentric(p: Point, a: Point, b: Point, c: Point): Barycentric {
	const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
	const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / denom;
	const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / denom;
	return { u, v, w: 1 - u - v };
}

export function barycentricToPoint(bary: Barycentric, a: Point, b: Point, c: Point): Point {
	return {
		x: bary.u * a.x + bary.v * b.x + bary.w * c.x,
		y: bary.u * a.y + bary.v * b.y + bary.w * c.y
	};
}

/** saturation/value(0~100) -> 삼각형 무게중심좌표. V=u+v, S=u/(u+v) 관계의 역변환 */
export function svToBarycentric(saturation: number, value: number): Barycentric {
	const vFrac = value / 100;
	const u = (saturation / 100) * vFrac;
	return { u, v: vFrac - u, w: 1 - vFrac };
}

export function barycentricToSv(bary: Barycentric): { saturation: number; value: number } {
	const vFrac = bary.u + bary.v;
	return { saturation: vFrac > 0 ? (bary.u / vFrac) * 100 : 0, value: vFrac * 100 };
}

function sub(a: Point, b: Point): Point {
	return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Point, b: Point): Point {
	return { x: a.x + b.x, y: a.y + b.y };
}
function scale(a: Point, s: number): Point {
	return { x: a.x * s, y: a.y * s };
}
function dot(a: Point, b: Point): number {
	return a.x * b.x + a.y * b.y;
}

/**
 * 삼각형 바깥을 드래그해도 선택 지점이 항상 유효한 색이 되도록, 점을 삼각형 내부의 가장 가까운
 * 점으로 클램프한다(Ericson, Real-Time Collision Detection의 표준 최근접점 알고리즘).
 */
export function closestPointInTriangle(p: Point, a: Point, b: Point, c: Point): Point {
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) return a;

	const bp = sub(p, b);
	const d3 = dot(ab, bp);
	const d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) return b;

	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const t = d1 / (d1 - d3);
		return add(a, scale(ab, t));
	}

	const cp = sub(p, c);
	const d5 = dot(ab, cp);
	const d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) return c;

	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const t = d2 / (d2 - d6);
		return add(a, scale(ac, t));
	}

	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return add(b, scale(sub(c, b), t));
	}

	const denom = 1 / (va + vb + vc);
	return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

export function drawHueRing(ctx: CanvasRenderingContext2D, geo: WheelGeometry): void {
	const { center, outerRadius, innerRadius } = geo;
	ctx.clearRect(0, 0, geo.size, geo.size);

	const gradient = ctx.createConicGradient(-Math.PI / 2, center.x, center.y);
	for (let deg = 0; deg <= 360; deg += 10) {
		const rgb = hsbToRgb({ h: deg, s: 100, b: 100 });
		gradient.addColorStop(deg / 360, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
	}

	ctx.save();
	ctx.beginPath();
	ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
	ctx.arc(center.x, center.y, innerRadius, 0, Math.PI * 2, true);
	ctx.closePath();
	ctx.clip();
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, geo.size, geo.size);
	ctx.restore();
}

export function drawSvTriangle(
	ctx: CanvasRenderingContext2D,
	geo: WheelGeometry,
	hue: number
): void {
	const { size } = geo;
	const { hue: a, white: b, black: c } = triangleVertices(geo, hue);
	const hueColor = hsbToRgb({ h: hue, s: 100, b: 100 });
	const white: RGB = { r: 255, g: 255, b: 255 };
	const black: RGB = { r: 0, g: 0, b: 0 };

	const image = ctx.createImageData(size, size);
	const data = image.data;
	const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
	const EPS = -0.02;

	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const u = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / denom;
			const v = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / denom;
			const w = 1 - u - v;
			if (u < EPS || v < EPS || w < EPS) continue;

			const idx = (py * size + px) * 4;
			data[idx] = u * hueColor.r + v * white.r + w * black.r;
			data[idx + 1] = u * hueColor.g + v * white.g + w * black.g;
			data[idx + 2] = u * hueColor.b + v * white.b + w * black.b;
			data[idx + 3] = 255;
		}
	}
	ctx.putImageData(image, 0, 0);
}
