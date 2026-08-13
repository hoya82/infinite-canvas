import { describe, expect, it } from 'vitest';
import {
	HIGH_QUALITY_SWEET_SPOT,
	resolveTileWebpQuality,
	verifyNativeLosslessWebp
} from './webpCodec';

describe('webpCodec', () => {
	it('quality=1.0 캔버스 네이티브 인코딩의 무손실 여부를 실측하고, 결과에 맞는 quality를 고른다', async () => {
		const lossless = await verifyNativeLosslessWebp();
		// 실행 브라우저 엔진에 따라 결과가 달라질 수 있어 값 자체를 강제하지 않고 기록만 남긴다.
		console.log(`[webpCodec spike] quality=1.0 무손실 여부: ${lossless}`);

		const quality = await resolveTileWebpQuality();
		expect(quality).toBe(lossless ? 1 : HIGH_QUALITY_SWEET_SPOT);
	});

	it('resolveTileWebpQuality 결과를 메모이즈한다', async () => {
		const first = await resolveTileWebpQuality();
		const second = await resolveTileWebpQuality();
		expect(second).toBe(first);
	});
});
