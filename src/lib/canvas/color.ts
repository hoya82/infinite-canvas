/** HSB(HSV)/RGB/hex 색상 변환 — Krita 스타일 컬러 피커(M6)가 사용하는 순수 함수 모음 */

export interface HSB {
	/** 0~360 */
	h: number;
	/** 0~100 */
	s: number;
	/** 0~100 */
	b: number;
}

export interface RGB {
	/** 0~255 */
	r: number;
	g: number;
	b: number;
}

export function hsbToRgb(hsb: HSB): RGB {
	const s = hsb.s / 100;
	const v = hsb.b / 100;
	const c = v * s;
	const hPrime = (((hsb.h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hPrime % 2) - 1));
	const m = v - c;

	const sextant = Math.floor(hPrime) % 6;
	const [r1, g1, b1] = [
		[c, x, 0],
		[x, c, 0],
		[0, c, x],
		[0, x, c],
		[x, 0, c],
		[c, 0, x]
	][sextant] ?? [0, 0, 0];

	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255)
	};
}

export function rgbToHsb(rgb: RGB): HSB {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;

	let h = 0;
	if (delta !== 0) {
		if (max === r) h = 60 * (((g - b) / delta) % 6);
		else if (max === g) h = 60 * ((b - r) / delta + 2);
		else h = 60 * ((r - g) / delta + 4);
	}
	if (h < 0) h += 360;

	const s = max === 0 ? 0 : delta / max;

	return { h, s: s * 100, b: max * 100 };
}

function componentToHex(n: number): string {
	const clamped = Math.max(0, Math.min(255, Math.round(n)));
	return clamped.toString(16).padStart(2, '0');
}

export function rgbToHex(rgb: RGB): string {
	return `#${componentToHex(rgb.r)}${componentToHex(rgb.g)}${componentToHex(rgb.b)}`;
}

/** `#rgb` 또는 `#rrggbb`(대소문자, # 유무 무관) 형식만 인정한다. 그 외는 null */
export function hexToRgb(hex: string): RGB | null {
	const trimmed = hex.trim();
	const shortMatch = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
	if (shortMatch) {
		return {
			r: parseInt(shortMatch[1] + shortMatch[1], 16),
			g: parseInt(shortMatch[2] + shortMatch[2], 16),
			b: parseInt(shortMatch[3] + shortMatch[3], 16)
		};
	}

	const match = /^#?([0-9a-f]{6})$/i.exec(trimmed);
	if (!match) return null;
	const int = parseInt(match[1], 16);
	return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
