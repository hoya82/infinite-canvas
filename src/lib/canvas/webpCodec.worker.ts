/**
 * 타일 하나의 원본 픽셀을 webp로 인코딩하는 Worker.
 * 저장은 "압축률보다 빠른 저장"이 우선이므로, dirty 타일 여러 개를 이 워커의 풀(webpWorkerPool.ts)에서
 * 병렬로 처리해 메인 스레드를 막지 않는다.
 */
import { TILE_SIZE } from './types';
import { encodeTileWebp, resolveTileWebpQuality } from './webpCodec';

export interface EncodeRequest {
	id: number;
	pixels: ArrayBuffer;
}

export interface EncodeResponse {
	id: number;
	webp: ArrayBuffer;
}

self.onmessage = async (event: MessageEvent<EncodeRequest>) => {
	const { id, pixels } = event.data;

	const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');
	ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), TILE_SIZE, TILE_SIZE), 0, 0);

	const quality = await resolveTileWebpQuality();
	const blob = await encodeTileWebp(canvas, quality);
	const webp = await blob.arrayBuffer();

	const response: EncodeResponse = { id, webp };
	postMessage(response, { transfer: [webp] });
};
