/**
 * WebP 인코딩/디코딩 — 캔버스 네이티브 API만 사용한다 (WASM 코덱 의존성 없음).
 *
 * `OffscreenCanvas.convertToBlob({ type: 'image/webp', quality: 1 })`가 실제로 무손실
 * 인코딩으로 동작하는지는 브라우저 엔진마다 문서화되어 있지 않으므로, 가정하지 않고
 * {@link verifyNativeLosslessWebp}로 알려진 고주파 픽셀 패턴을 인코딩→디코딩→바이트 비교하여
 * 실측 검증한다. 무손실이 아닌 것으로 확인되면 quality를 1이 아니라
 * {@link HIGH_QUALITY_SWEET_SPOT}(고주파 성분 손실은 줄이면서 인코딩 속도는 빠른 지점)로
 * 고정해서 사용한다. 저장은 "압축률보다 빠른 저장"이 우선이므로, 인코딩은 항상 Worker
 * 풀에서 병렬로 수행하는 것을 전제로 한다(Worker 연동은 M5에서 tileStore/저장 로직과 함께 배선).
 */

/** quality=1.0이 무손실이 아닐 때 사용할 고품질 손실 모드 값 (0.90~0.95 구간 중 선택) */
export const HIGH_QUALITY_SWEET_SPOT = 0.92;

let cachedQuality: number | null = null;

export async function encodeTileWebp(canvas: OffscreenCanvas, quality: number): Promise<Blob> {
	return canvas.convertToBlob({ type: 'image/webp', quality });
}

export async function decodeTileWebp(blob: Blob): Promise<ImageBitmap> {
	return createImageBitmap(blob);
}

/**
 * quality=1.0 인코딩이 실제로 무손실인지 실측한다.
 * 알파 프리멀티플라이 반올림이라는 별개 변수를 배제하기 위해 완전 불투명(alpha=255) 픽셀만 사용해
 * 순수하게 WebP 색상 채널 인코딩 자체의 무손실 여부만 확인한다.
 */
export async function verifyNativeLosslessWebp(): Promise<boolean> {
	const size = 64;
	const source = new OffscreenCanvas(size, size);
	const sourceCtx = source.getContext('2d', { willReadFrequently: true });
	if (!sourceCtx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');

	const original = sourceCtx.createImageData(size, size);
	for (let i = 0; i < original.data.length; i += 4) {
		const idx = i / 4;
		const x = idx % size;
		const y = Math.floor(idx / size);
		// 체크보드 + 대각 그라디언트: 손실 압축에서 가장 먼저 무너지는 고주파 패턴
		original.data[i] = (x ^ y) & 1 ? 255 : 0;
		original.data[i + 1] = (x * 4) % 256;
		original.data[i + 2] = (y * 4) % 256;
		original.data[i + 3] = 255;
	}
	sourceCtx.putImageData(original, 0, 0);

	const blob = await encodeTileWebp(source, 1);
	const bitmap = await decodeTileWebp(blob);

	const roundTrip = new OffscreenCanvas(size, size);
	const roundTripCtx = roundTrip.getContext('2d', { willReadFrequently: true });
	if (!roundTripCtx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');
	roundTripCtx.drawImage(bitmap, 0, 0);
	const decoded = roundTripCtx.getImageData(0, 0, size, size);

	for (let i = 0; i < original.data.length; i++) {
		if (original.data[i] !== decoded.data[i]) return false;
	}
	return true;
}

/** 무손실 검증 결과(메모이즈됨)에 따라 실제 저장에 사용할 quality 값을 반환한다 */
export async function resolveTileWebpQuality(): Promise<number> {
	if (cachedQuality === null) {
		const lossless = await verifyNativeLosslessWebp();
		cachedQuality = lossless ? 1 : HIGH_QUALITY_SWEET_SPOT;
	}
	return cachedQuality;
}

/** webp Blob을 디코딩해 IndexedDB 작업 영역에 저장할 원본 RGBA8 픽셀 버퍼로 변환한다 */
export async function webpBlobToRawPixels(blob: Blob, size: number): Promise<ArrayBuffer> {
	const bitmap = await decodeTileWebp(blob);
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');
	ctx.drawImage(bitmap, 0, 0);
	return ctx.getImageData(0, 0, size, size).data.buffer;
}
