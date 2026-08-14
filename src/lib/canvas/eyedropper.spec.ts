import { describe, expect, it } from 'vitest';
import { worldToTilePixel } from './eyedropper';

describe('worldToTilePixel', () => {
	it('원점 타일(0,0) 내부 좌표는 타일 좌표 (0,0) + 그대로인 로컬 픽셀 좌표로 변환된다', () => {
		expect(worldToTilePixel(10, 20)).toEqual({ tileX: 0, tileY: 0, pixelX: 10, pixelY: 20 });
	});

	it('타일 경계를 넘어가면 다음 타일 좌표로, 로컬 픽셀은 0부터 다시 시작한다', () => {
		expect(worldToTilePixel(512, 0)).toEqual({ tileX: 1, tileY: 0, pixelX: 0, pixelY: 0 });
		expect(worldToTilePixel(511.9, 0)).toEqual({ tileX: 0, tileY: 0, pixelX: 511, pixelY: 0 });
	});

	it('음수 월드 좌표도 타일 격자에 맞게 내림 처리한다(0쪽으로 절단되지 않는다)', () => {
		expect(worldToTilePixel(-1, -1)).toEqual({ tileX: -1, tileY: -1, pixelX: 511, pixelY: 511 });
		expect(worldToTilePixel(-512, -512)).toEqual({ tileX: -1, tileY: -1, pixelX: 0, pixelY: 0 });
	});

	it('소수점 픽셀 좌표는 내림(floor)해 정수 픽셀 인덱스로 만든다', () => {
		expect(worldToTilePixel(10.7, 20.2)).toEqual({ tileX: 0, tileY: 0, pixelX: 10, pixelY: 20 });
	});
});
