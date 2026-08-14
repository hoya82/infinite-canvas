<script lang="ts">
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type HSB } from '$lib/canvas/color';
	import {
		angleRadToHue,
		barycentricToPoint,
		barycentricToSv,
		cartesianToBarycentric,
		closestPointInTriangle,
		drawHueRing,
		drawSvTriangle,
		getWheelGeometry,
		pointOnRing,
		svToBarycentric,
		triangleVertices,
		type Point
	} from '$lib/canvas/colorWheel';
	import { documentState } from '$lib/canvas/document.svelte';
	import { toolState } from '$lib/canvas/toolState.svelte';

	const WHEEL_SIZE = 200;
	const RING_THICKNESS = 24;
	const TRIANGLE_GAP = 6;
	const SCRATCH_WIDTH = 150;
	const SCRATCH_HEIGHT = 90;
	const SCRATCH_BRUSH_SIZE = 10;

	const geometry = getWheelGeometry(WHEEL_SIZE, RING_THICKNESS, TRIANGLE_GAP);

	function seedFromToolColor(): HSB {
		const rgb = hexToRgb(toolState.color) ?? { r: 0, g: 0, b: 0 };
		return rgbToHsb(rgb);
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	let hsb = $state<HSB>(seedFromToolColor());
	let mode = $state<'hsb' | 'rgb'>('hsb');

	const rgb = $derived(hsbToRgb(hsb));
	const hex = $derived(rgbToHex(rgb));
	let hexInput = $derived(hex);

	$effect(() => {
		toolState.color = hex;
	});

	function commitHexInput(): void {
		const parsed = hexToRgb(hexInput);
		if (parsed) {
			hsb = rgbToHsb(parsed);
		} else {
			hexInput = hex;
		}
	}

	function selectHistoryColor(swatchHex: string): void {
		const parsed = hexToRgb(swatchHex);
		if (parsed) hsb = rgbToHsb(parsed);
	}

	function setHsbChannel(channel: 'h' | 's' | 'b', raw: number): void {
		const value = channel === 'h' ? clamp(raw, 0, 360) : clamp(raw, 0, 100);
		hsb = { ...hsb, [channel]: value };
	}

	function setRgbChannel(channel: 'r' | 'g' | 'b', raw: number): void {
		hsb = rgbToHsb({ ...rgb, [channel]: clamp(raw, 0, 255) });
	}

	function channelInput(setter: (raw: number) => void) {
		return (e: Event) => setter(Number((e.target as HTMLInputElement).value));
	}

	// --- 컬러 휠 (Hue 링 + Saturation/Value 삼각형) ---

	let wheelEl: HTMLDivElement | undefined = $state();
	let ringCanvas: HTMLCanvasElement | undefined = $state();
	let triangleCanvas: HTMLCanvasElement | undefined = $state();
	let dragTarget: 'ring' | 'triangle' | null = null;

	$effect(() => {
		if (!ringCanvas) return;
		const ctx = ringCanvas.getContext('2d');
		if (ctx) drawHueRing(ctx, geometry);
	});

	$effect(() => {
		const hue = hsb.h;
		if (!triangleCanvas) return;
		const ctx = triangleCanvas.getContext('2d');
		if (ctx) drawSvTriangle(ctx, geometry, hue);
	});

	const ringThumbPos = $derived(pointOnRing(geometry, hsb.h));
	const currentTriangle = $derived(triangleVertices(geometry, hsb.h));
	const triangleThumbPos = $derived(
		barycentricToPoint(
			svToBarycentric(hsb.s, hsb.b),
			currentTriangle.hue,
			currentTriangle.white,
			currentTriangle.black
		)
	);

	function localPoint(e: PointerEvent): Point {
		const rect = wheelEl!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function applyRingPoint(p: Point): void {
		const dx = p.x - geometry.center.x;
		const dy = p.y - geometry.center.y;
		hsb = { ...hsb, h: angleRadToHue(Math.atan2(dy, dx)) };
	}

	function applyTrianglePoint(p: Point): void {
		const { hue: a, white: b, black: c } = currentTriangle;
		const clamped = closestPointInTriangle(p, a, b, c);
		const { saturation, value } = barycentricToSv(cartesianToBarycentric(clamped, a, b, c));
		hsb = { ...hsb, s: saturation, b: value };
	}

	function applyWheelPoint(p: Point): void {
		if (dragTarget === 'ring') applyRingPoint(p);
		else if (dragTarget === 'triangle') applyTrianglePoint(p);
	}

	function handleWheelPointerDown(e: PointerEvent): void {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const p = localPoint(e);
		const dist = Math.hypot(p.x - geometry.center.x, p.y - geometry.center.y);
		dragTarget = dist > geometry.innerRadius ? 'ring' : 'triangle';
		applyWheelPoint(p);
	}

	function handleWheelPointerMove(e: PointerEvent): void {
		if (!dragTarget || e.buttons !== 1) return;
		applyWheelPoint(localPoint(e));
	}

	function handleWheelPointerUp(): void {
		dragTarget = null;
	}

	// --- 컬러 미리보기용 스크래치 패드 ---

	let scratchCanvas: HTMLCanvasElement | undefined = $state();
	let scratchCtx: CanvasRenderingContext2D | null = null;
	let scratchDrawing = false;
	const scratchBg = $derived(documentState.doc?.background.color ?? '#ffffff');

	function scratchPoint(e: PointerEvent): Point {
		const rect = scratchCanvas!.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	function handleScratchPointerDown(e: PointerEvent): void {
		if (!scratchCanvas) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		scratchCtx ??= scratchCanvas.getContext('2d');
		if (!scratchCtx) return;
		scratchDrawing = true;
		scratchCtx.strokeStyle = hex;
		scratchCtx.lineWidth = SCRATCH_BRUSH_SIZE;
		scratchCtx.lineCap = 'round';
		scratchCtx.lineJoin = 'round';
		const p = scratchPoint(e);
		scratchCtx.beginPath();
		scratchCtx.moveTo(p.x, p.y);
		scratchCtx.lineTo(p.x, p.y);
		scratchCtx.stroke();
	}

	function handleScratchPointerMove(e: PointerEvent): void {
		if (!scratchDrawing || e.buttons !== 1 || !scratchCtx) return;
		const p = scratchPoint(e);
		scratchCtx.lineTo(p.x, p.y);
		scratchCtx.stroke();
	}

	function handleScratchPointerUp(): void {
		if (scratchDrawing) toolState.addColorToHistory(hex);
		scratchDrawing = false;
	}

	function clearScratch(): void {
		if (!scratchCtx || !scratchCanvas) return;
		scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
	}
</script>

<div class="color-picker">
	<div class="main-row">
		<div
			class="wheel"
			bind:this={wheelEl}
			style:width="{WHEEL_SIZE}px"
			style:height="{WHEEL_SIZE}px"
			role="slider"
			aria-label="색상 휠"
			aria-valuenow={Math.round(hsb.h)}
			tabindex="0"
			onpointerdown={handleWheelPointerDown}
			onpointermove={handleWheelPointerMove}
			onpointerup={handleWheelPointerUp}
			onpointercancel={handleWheelPointerUp}
		>
			<canvas bind:this={ringCanvas} width={WHEEL_SIZE} height={WHEEL_SIZE} class="ring-canvas"
			></canvas>
			<canvas
				bind:this={triangleCanvas}
				width={WHEEL_SIZE}
				height={WHEEL_SIZE}
				class="triangle-canvas"
			></canvas>
			<div class="ring-thumb" style:left="{ringThumbPos.x}px" style:top="{ringThumbPos.y}px"></div>
			<div
				class="triangle-thumb"
				style:left="{triangleThumbPos.x}px"
				style:top="{triangleThumbPos.y}px"
				style:background={hex}
			></div>
		</div>

		<div class="palette-col">
			<div class="history-label">최근 사용한 색</div>
			<div class="history-grid">
				{#each toolState.colorHistory as swatch (swatch)}
					<button
						type="button"
						class="history-swatch"
						style:background={swatch}
						aria-label="색상 {swatch} 선택"
						onclick={() => selectHistoryColor(swatch)}
					></button>
				{/each}
				{#if toolState.colorHistory.length === 0}
					<p class="history-empty">사용한 색이 여기 쌓입니다</p>
				{/if}
			</div>

			<div class="scratch-wrap">
				<div class="scratch-header">
					<span>미리보기</span>
					<button
						type="button"
						class="scratch-clear"
						aria-label="스크래치 패드 지우기"
						onclick={clearScratch}
					>
						<Trash2 size={12} />
					</button>
				</div>
				<canvas
					bind:this={scratchCanvas}
					width={SCRATCH_WIDTH}
					height={SCRATCH_HEIGHT}
					class="scratch-pad"
					style:background={scratchBg}
					onpointerdown={handleScratchPointerDown}
					onpointermove={handleScratchPointerMove}
					onpointerup={handleScratchPointerUp}
					onpointercancel={handleScratchPointerUp}
				></canvas>
			</div>
		</div>
	</div>

	<div class="tabs">
		<button type="button" class:active={mode === 'hsb'} onclick={() => (mode = 'hsb')}>HSB</button>
		<button type="button" class:active={mode === 'rgb'} onclick={() => (mode = 'rgb')}>RGB</button>
	</div>

	<div class="value-panel">
		{#if mode === 'hsb'}
			<label>
				H
				<input
					type="number"
					min="0"
					max="360"
					step="1"
					value={Math.round(hsb.h)}
					oninput={channelInput((v) => setHsbChannel('h', v))}
				/>
				<span class="unit">°</span>
			</label>
			<label>
				S
				<input
					type="number"
					min="0"
					max="100"
					step="1"
					value={Math.round(hsb.s)}
					oninput={channelInput((v) => setHsbChannel('s', v))}
				/>
				<span class="unit">%</span>
			</label>
			<label>
				B
				<input
					type="number"
					min="0"
					max="100"
					step="1"
					value={Math.round(hsb.b)}
					oninput={channelInput((v) => setHsbChannel('b', v))}
				/>
				<span class="unit">%</span>
			</label>
		{:else}
			<label>
				R
				<input
					type="number"
					min="0"
					max="255"
					step="1"
					value={rgb.r}
					oninput={channelInput((v) => setRgbChannel('r', v))}
				/>
			</label>
			<label>
				G
				<input
					type="number"
					min="0"
					max="255"
					step="1"
					value={rgb.g}
					oninput={channelInput((v) => setRgbChannel('g', v))}
				/>
			</label>
			<label>
				B
				<input
					type="number"
					min="0"
					max="255"
					step="1"
					value={rgb.b}
					oninput={channelInput((v) => setRgbChannel('b', v))}
				/>
			</label>
		{/if}
	</div>

	<div class="hex-row">
		<span class="preview">
			<span class="preview-fill" style:background={hex}></span>
		</span>
		<input
			class="hex-input"
			bind:value={hexInput}
			onblur={commitHexInput}
			onkeydown={(e) => e.key === 'Enter' && commitHexInput()}
		/>
	</div>
</div>

<style>
	.color-picker {
		width: 392px;
		padding: 10px;
		background: #2b2b2b;
		color: #eee;
		font-size: 12px;
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		box-sizing: border-box;
	}

	.main-row {
		display: flex;
		gap: 14px;
		height: 200px;
	}

	.wheel {
		position: relative;
		flex-shrink: 0;
		touch-action: none;
	}

	.ring-canvas,
	.triangle-canvas {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
	}

	.ring-thumb,
	.triangle-thumb {
		position: absolute;
		width: 12px;
		height: 12px;
		border: 2px solid #fff;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.ring-thumb {
		background: transparent;
	}

	.palette-col {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
	}

	.history-label {
		opacity: 0.7;
		margin-bottom: 4px;
	}

	.history-grid {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 4px;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.history-grid::-webkit-scrollbar {
		width: 0;
		height: 0;
	}

	.history-empty {
		margin: 0;
		font-size: 11px;
		opacity: 0.5;
	}

	.history-swatch {
		width: 18px;
		height: 18px;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 3px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.scratch-wrap {
		margin-top: 8px;
		flex-shrink: 0;
	}

	.scratch-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		opacity: 0.7;
		margin-bottom: 3px;
	}

	.scratch-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: transparent;
		border: none;
		color: inherit;
		cursor: pointer;
		opacity: 0.8;
	}

	.scratch-clear:hover {
		opacity: 1;
	}

	.scratch-pad {
		display: block;
		width: 100%;
		height: 90px;
		border: 1px solid #444;
		border-radius: 3px;
		touch-action: none;
		box-sizing: border-box;
	}

	.tabs {
		display: flex;
		gap: 4px;
		margin-top: 10px;
		margin-bottom: 8px;
	}

	.tabs button {
		flex: 1;
		background: #3a3a3a;
		border: none;
		color: inherit;
		padding: 4px 0;
		cursor: pointer;
		border-radius: 3px;
	}

	.tabs button.active {
		background: #5a7fbf;
	}

	.value-panel {
		display: flex;
		gap: 8px;
	}

	.value-panel label {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.value-panel input {
		width: 0;
		flex: 1;
		box-sizing: border-box;
		background: #1e1e1e;
		border: 1px solid #444;
		color: inherit;
		padding: 3px 4px;
		border-radius: 3px;
	}

	.unit {
		opacity: 0.6;
	}

	.hex-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 10px;
	}

	/* 스워치와 동일한 흰 테두리 + 검은 얇은 선 이중 구조 — 검정을 포함해 어떤 색이든 경계가 보인다 */
	.preview {
		width: 22px;
		height: 22px;
		padding: 2px;
		background: #fff;
		border-radius: 4px;
		flex-shrink: 0;
		box-sizing: border-box;
	}

	.preview-fill {
		display: block;
		width: 100%;
		height: 100%;
		border: 1px solid #000;
		border-radius: 2px;
		box-sizing: border-box;
	}

	.hex-input {
		flex: 1;
		box-sizing: border-box;
		background: #1e1e1e;
		border: 1px solid #444;
		color: inherit;
		padding: 3px 6px;
		border-radius: 3px;
	}
</style>
