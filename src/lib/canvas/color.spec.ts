import { describe, expect, it } from 'vitest';
import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type RGB } from './color';

describe('hsbToRgb', () => {
	it('알려진 색상들을 정확히 변환한다', () => {
		expect(hsbToRgb({ h: 0, s: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 }); // 검정
		expect(hsbToRgb({ h: 0, s: 0, b: 100 })).toEqual({ r: 255, g: 255, b: 255 }); // 흰색
		expect(hsbToRgb({ h: 0, s: 100, b: 100 })).toEqual({ r: 255, g: 0, b: 0 }); // 빨강
		expect(hsbToRgb({ h: 120, s: 100, b: 100 })).toEqual({ r: 0, g: 255, b: 0 }); // 초록
		expect(hsbToRgb({ h: 240, s: 100, b: 100 })).toEqual({ r: 0, g: 0, b: 255 }); // 파랑
	});

	it('360도와 0도는 같은 색을 가리킨다', () => {
		expect(hsbToRgb({ h: 360, s: 100, b: 100 })).toEqual(hsbToRgb({ h: 0, s: 100, b: 100 }));
	});
});

describe('rgbToHsb', () => {
	it('hsbToRgb의 역함수다 (왕복 변환)', () => {
		const samples: RGB[] = [
			{ r: 0, g: 0, b: 0 },
			{ r: 255, g: 255, b: 255 },
			{ r: 255, g: 0, b: 0 },
			{ r: 12, g: 200, b: 90 },
			{ r: 128, g: 64, b: 200 }
		];

		for (const rgb of samples) {
			const hsb = rgbToHsb(rgb);
			const roundTripped = hsbToRgb(hsb);
			expect(roundTripped.r).toBeCloseTo(rgb.r, 0);
			expect(roundTripped.g).toBeCloseTo(rgb.g, 0);
			expect(roundTripped.b).toBeCloseTo(rgb.b, 0);
		}
	});

	it('무채색(회색)은 hue/saturation이 0이다', () => {
		const hsb = rgbToHsb({ r: 128, g: 128, b: 128 });
		expect(hsb.s).toBe(0);
		expect(hsb.b).toBeCloseTo((128 / 255) * 100, 5);
	});
});

describe('rgbToHex / hexToRgb', () => {
	it('rgbToHex는 #rrggbb 소문자 형식으로 만든다', () => {
		expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#ff0000');
		expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
		expect(rgbToHex({ r: 18, g: 200, b: 9 })).toBe('#12c809');
	});

	it('hexToRgb는 #과 대소문자, 3자리 축약형을 모두 허용한다', () => {
		expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
		expect(hexToRgb('FF0000')).toEqual({ r: 255, g: 0, b: 0 });
		expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
	});

	it('잘못된 형식은 null을 반환한다', () => {
		expect(hexToRgb('not-a-color')).toBeNull();
		expect(hexToRgb('#12345')).toBeNull();
		expect(hexToRgb('')).toBeNull();
	});

	it('hex -> rgb -> hex 왕복이 원래 문자열을 보존한다', () => {
		expect(rgbToHex(hexToRgb('#a1b2c3')!)).toBe('#a1b2c3');
	});
});
