<script lang="ts">
	import { merge } from 'rxjs';
	import { createStroke$ } from '$lib/canvas/brushEngine';
	import { db } from '$lib/canvas/db';
	import { documentState } from '$lib/canvas/document.svelte';
	import { createCanvasInput, type CursorMode } from '$lib/canvas/input';
	import { collectVisibleExistingTiles, render } from '$lib/canvas/renderer';
	import { TileStore, tileKey } from '$lib/canvas/tileStore';
	import { toolState } from '$lib/canvas/toolState.svelte';
	import { Viewport } from '$lib/canvas/viewport.svelte';

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let tileStore: TileStore | null = $state(null);
	let backgroundTexture: ImageBitmap | null = $state(null);

	let cursorX = $state(0);
	let cursorY = $state(0);
	let cursorVisible = $state(false);
	let cursorMode = $state<CursorMode>('draw');

	const viewport = new Viewport();
	const cursorDiameter = $derived(toolState.activeSize * viewport.zoom);
	const canvasCursorStyle = $derived(
		cursorMode === 'draw' ? 'none' : cursorMode === 'zoom' ? 'zoom-in' : cursorMode // 'grab' | 'grabbing' — CSS 커서 키워드와 이름이 그대로 같다
	);

	let rafHandle: number | null = null;

	function scheduleRender(): void {
		if (rafHandle !== null) return;
		rafHandle = requestAnimationFrame(() => {
			rafHandle = null;
			doRender();
		});
	}

	function doRender(): void {
		if (!canvasEl || !tileStore || !documentState.doc) return;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;

		const layerIds = documentState.orderedLayers.map((layer) => layer.id);
		const visible = collectVisibleExistingTiles(viewport, tileStore);
		tileStore.ensureLoaded(visible, layerIds);
		tileStore.evictOutside(new Set(visible.map((coord) => tileKey(coord.x, coord.y))));

		render({
			ctx,
			viewport,
			tileStore,
			layers: documentState.orderedLayers,
			background: documentState.doc.background,
			backgroundTexture
		});
	}

	// 도큐먼트가 (처음 또는 전환으로) 바뀌면 타일 스토어를 새로 만든다
	$effect(() => {
		const doc = documentState.doc;
		if (!doc) return;
		const store = new TileStore(doc.id, scheduleRender);
		tileStore = store;
		store.refreshExistingTiles().then(scheduleRender);
	});

	// 배경이 텍스처면 Dexie에서 이미지를 불러온다
	$effect(() => {
		const background = documentState.doc?.background;
		if (!background || background.type !== 'texture' || !background.textureId) {
			backgroundTexture = null;
			scheduleRender();
			return;
		}

		let cancelled = false;
		db.textures.get(background.textureId).then(async (record) => {
			if (cancelled || !record) return;
			backgroundTexture = await createImageBitmap(record.blob);
			scheduleRender();
		});

		return () => {
			cancelled = true;
		};
	});

	// 캔버스 크기 관리 + 입력/드로잉 스트림 연결 (마운트 시 1회)
	$effect(() => {
		if (!canvasEl || !containerEl) return;
		const canvas = canvasEl;
		const container = containerEl;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		function resize(): void {
			const rect = container.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = Math.max(1, Math.round(rect.width * dpr));
			canvas.height = Math.max(1, Math.round(rect.height * dpr));
			ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
			viewport.width = rect.width;
			viewport.height = rect.height;
			scheduleRender();
		}

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(container);
		resize();

		const input = createCanvasInput(canvas);
		const subscriptions = [
			input.pan$.subscribe((delta) => {
				viewport.panByScreenDelta(delta.dxScreen, delta.dyScreen);
				scheduleRender();
			}),
			input.zoomDrag$.subscribe((gesture) => {
				viewport.zoomAt(gesture.anchorScreenX, gesture.anchorScreenY, gesture.factor);
				scheduleRender();
			}),
			input.wheelZoom$.subscribe((gesture) => {
				viewport.zoomAt(gesture.anchorScreenX, gesture.anchorScreenY, gesture.factor);
				scheduleRender();
			}),
			input.toggleTool$.subscribe(() => {
				toolState.toggleTool();
			}),
			input.cursorMode$.subscribe((mode) => {
				cursorMode = mode;
			}),
			merge(input.pointerMove$, input.pointerEnter$).subscribe((e) => {
				const rect = canvas.getBoundingClientRect();
				cursorX = e.clientX - rect.left;
				cursorY = e.clientY - rect.top;
				cursorVisible = true;
			}),
			input.pointerLeave$.subscribe(() => {
				cursorVisible = false;
			}),
			createStroke$({
				canvas,
				input,
				viewport,
				getTileStore: () => tileStore,
				getDocumentId: () => documentState.doc?.id ?? null,
				getActiveLayerId: () => documentState.activeLayerId,
				getSettings: () => ({
					tool: toolState.tool,
					brushSize: toolState.brushSize,
					eraserSize: toolState.eraserSize,
					color: toolState.color
				}),
				onChange: scheduleRender
			}).subscribe()
		];

		return () => {
			resizeObserver.disconnect();
			for (const subscription of subscriptions) subscription.unsubscribe();
			if (rafHandle !== null) cancelAnimationFrame(rafHandle);
		};
	});
</script>

<div bind:this={containerEl} class="canvas-stage">
	<canvas bind:this={canvasEl} style:cursor={canvasCursorStyle}></canvas>
	{#if cursorVisible && cursorMode === 'draw'}
		<div
			class="brush-cursor"
			style:left="{cursorX}px"
			style:top="{cursorY}px"
			style:width="{cursorDiameter}px"
			style:height="{cursorDiameter}px"
		></div>
	{/if}
</div>

<style>
	.canvas-stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
		touch-action: none;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.brush-cursor {
		position: absolute;
		pointer-events: none;
		border: 1px solid #000;
		outline: 1px solid rgba(255, 255, 255, 0.8);
		border-radius: 50%;
		transform: translate(-50%, -50%);
		mix-blend-mode: difference;
	}
</style>
