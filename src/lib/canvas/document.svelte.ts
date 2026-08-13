/** 현재 열려 있는 도큐먼트 + 레이어 스택의 반응형(runes) 상태 */
import { ensureBootstrapped, hydrateDocumentFromOpfs } from './bootstrap';
import { APP_STATE_ID, db } from './db';
import { generateId, type CanvasDocument, type Layer, type LayerMode } from './types';
import { encodeTileWebp, resolveTileWebpQuality } from './webpCodec';

export class DocumentState {
	doc = $state<CanvasDocument | null>(null);
	layers = $state<Layer[]>([]);
	loading = $state(true);
	/** 지금 그리기 대상이 되는 레이어. M4의 레이어 패널에서 선택을 바꿀 수 있다 */
	activeLayerId = $state<string | null>(null);

	/** 정렬된(스택 하단→상단) 레이어 목록. 컴포지팅은 이 순서대로 아래에서 위로 그린다 */
	orderedLayers = $derived(this.layers.slice().sort((a, b) => a.order - b.order));

	/** documentId를 주면 해당 도큐먼트를, 안 주면 부트스트랩 규칙(마지막 문서/최초 생성)을 따른다 */
	async load(documentId?: string): Promise<void> {
		this.loading = true;
		try {
			const doc = documentId
				? await hydrateDocumentFromOpfs(documentId)
				: await ensureBootstrapped();

			if (documentId) {
				await db.appState.put({ id: APP_STATE_ID, lastOpenedDocumentId: doc.id });
			}

			this.doc = doc;
			this.layers = await db.layers.where('documentId').equals(doc.id).sortBy('order');
			this.activeLayerId = this.orderedLayers.at(-1)?.id ?? null;
		} finally {
			this.loading = false;
		}
	}

	async refreshLayers(): Promise<void> {
		if (!this.doc) return;
		this.layers = await db.layers.where('documentId').equals(this.doc.id).sortBy('order');
	}

	/** 스택 맨 위에 새 레이어를 추가하고 활성 레이어로 선택한다 */
	async addLayer(name?: string): Promise<Layer> {
		if (!this.doc) throw new Error('열려 있는 도큐먼트가 없습니다.');
		const layer: Layer = {
			id: generateId(),
			documentId: this.doc.id,
			name: name ?? `레이어 ${this.layers.length + 1}`,
			mode: 'normal',
			opacity: 1,
			visible: true,
			order: (this.orderedLayers.at(-1)?.order ?? -1) + 1
		};
		await db.layers.add(layer);
		this.layers = [...this.layers, layer];
		this.activeLayerId = layer.id;
		return layer;
	}

	/** 마지막 남은 한 장은 지울 수 없다 (도큐먼트는 항상 최소 1개의 레이어를 가진다) */
	async removeLayer(layerId: string): Promise<void> {
		if (!this.doc || this.layers.length <= 1) return;
		const documentId = this.doc.id;

		await db.transaction('rw', db.layers, db.tilePixels, async () => {
			await db.layers.delete(layerId);
			await db.tilePixels.where('[documentId+layerId]').equals([documentId, layerId]).delete();
		});

		this.layers = this.layers.filter((layer) => layer.id !== layerId);
		if (this.activeLayerId === layerId) {
			this.activeLayerId = this.orderedLayers.at(-1)?.id ?? null;
		}
	}

	async renameLayer(layerId: string, name: string): Promise<void> {
		const trimmed = name.trim();
		if (trimmed.length === 0) return;
		await db.layers.update(layerId, { name: trimmed });
		this.layers = this.layers.map((layer) =>
			layer.id === layerId ? { ...layer, name: trimmed } : layer
		);
	}

	async setLayerMode(layerId: string, mode: LayerMode): Promise<void> {
		await db.layers.update(layerId, { mode });
		this.layers = this.layers.map((layer) => (layer.id === layerId ? { ...layer, mode } : layer));
	}

	async setLayerOpacity(layerId: string, opacity: number): Promise<void> {
		const clamped = Math.min(1, Math.max(0, opacity));
		await db.layers.update(layerId, { opacity: clamped });
		this.layers = this.layers.map((layer) =>
			layer.id === layerId ? { ...layer, opacity: clamped } : layer
		);
	}

	async setLayerVisible(layerId: string, visible: boolean): Promise<void> {
		await db.layers.update(layerId, { visible });
		this.layers = this.layers.map((layer) =>
			layer.id === layerId ? { ...layer, visible } : layer
		);
	}

	/** direction 'up'은 스택에서 더 위(order가 더 큰 레이어)와 자리를 바꾼다 */
	async moveLayer(layerId: string, direction: 'up' | 'down'): Promise<void> {
		const ordered = this.orderedLayers;
		const index = ordered.findIndex((layer) => layer.id === layerId);
		if (index === -1) return;
		const swapIndex = direction === 'up' ? index + 1 : index - 1;
		if (swapIndex < 0 || swapIndex >= ordered.length) return;

		const a = ordered[index];
		const b = ordered[swapIndex];
		const swapped = [
			{ ...a, order: b.order },
			{ ...b, order: a.order }
		];
		await db.layers.bulkPut(swapped);
		this.layers = this.layers.map((layer) => swapped.find((s) => s.id === layer.id) ?? layer);
	}

	async setBackgroundColor(color: string): Promise<void> {
		if (!this.doc) return;
		const updatedAt = Date.now();
		this.doc = { ...this.doc, background: { type: 'color', color }, updatedAt };
		await db.documents.update(this.doc.id, { background: this.doc.background, updatedAt });
	}

	/** 이미지를 seamless 텍스처로 등록해 배경으로 쓴다. 컨테이너 포맷과 맞추기 위해 webp로 변환해 저장한다 */
	async setBackgroundTexture(imageBlob: Blob): Promise<void> {
		if (!this.doc) return;

		const bitmap = await createImageBitmap(imageBlob);
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2D 컨텍스트를 생성할 수 없습니다.');
		ctx.drawImage(bitmap, 0, 0);
		const quality = await resolveTileWebpQuality();
		const webpBlob = await encodeTileWebp(canvas, quality);

		const textureId = generateId();
		await db.textures.put({ id: textureId, documentId: this.doc.id, blob: webpBlob });

		const updatedAt = Date.now();
		this.doc = {
			...this.doc,
			background: { type: 'texture', color: this.doc.background.color, textureId },
			updatedAt
		};
		await db.documents.update(this.doc.id, { background: this.doc.background, updatedAt });
	}
}

export const documentState = new DocumentState();
