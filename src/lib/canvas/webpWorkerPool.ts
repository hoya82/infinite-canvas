/** webpCodec.worker.ts 인스턴스 풀 — dirty 타일 인코딩을 여러 워커에 나눠 병렬로 처리한다 */
import WebpCodecWorker from './webpCodec.worker?worker';
import type { EncodeRequest, EncodeResponse } from './webpCodec.worker';

const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

interface PendingJob {
	resolve: (webp: ArrayBuffer) => void;
	reject: (err: unknown) => void;
}

class WebpWorkerPool {
	#workers: Worker[] = [];
	#nextWorker = 0;
	#nextId = 0;
	#pending = new Map<number, PendingJob>();

	#ensureWorkers(): Worker[] {
		if (this.#workers.length > 0) return this.#workers;

		for (let i = 0; i < POOL_SIZE; i++) {
			const worker = new WebpCodecWorker();
			worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
				const job = this.#pending.get(event.data.id);
				if (!job) return;
				this.#pending.delete(event.data.id);
				job.resolve(event.data.webp);
			};
			worker.onerror = (event: ErrorEvent) => {
				console.error('webp 인코딩 워커 오류', event);
			};
			this.#workers.push(worker);
		}

		return this.#workers;
	}

	/** pixels는 이 워커로 전송(transfer)되어 호출부에서는 더 이상 유효하지 않게 되므로, 재사용이 필요하면 미리 복사해서 넘긴다 */
	encode(pixels: ArrayBuffer): Promise<ArrayBuffer> {
		const workers = this.#ensureWorkers();
		const id = this.#nextId++;
		const worker = workers[this.#nextWorker];
		this.#nextWorker = (this.#nextWorker + 1) % workers.length;

		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			const request: EncodeRequest = { id, pixels };
			worker.postMessage(request, { transfer: [pixels] });
		});
	}
}

export const webpWorkerPool = new WebpWorkerPool();
