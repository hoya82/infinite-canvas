<script lang="ts">
	import { hexToRgb, hsbToRgb, rgbToHex, rgbToHsb, type HSB } from '$lib/canvas/color';
	import { toolState } from '$lib/canvas/toolState.svelte';

	function seedFromToolColor(): HSB {
		const rgb = hexToRgb(toolState.color) ?? { r: 0, g: 0, b: 0 };
		return rgbToHsb(rgb);
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

	function setRgbChannel(channel: 'r' | 'g' | 'b', value: number): void {
		hsb = rgbToHsb({ ...rgb, [channel]: value });
	}

	let svArea: HTMLDivElement | undefined = $state();

	function updateSvFromPointer(e: PointerEvent): void {
		if (!svArea) return;
		const rect = svArea.getBoundingClientRect();
		const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
		hsb = { h: hsb.h, s: x * 100, b: (1 - y) * 100 };
	}

	function handleSvPointerDown(e: PointerEvent): void {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateSvFromPointer(e);
	}

	function handleSvPointerMove(e: PointerEvent): void {
		if (e.buttons !== 1) return;
		updateSvFromPointer(e);
	}

	function handleHueInput(e: Event): void {
		hsb = { ...hsb, h: Number((e.target as HTMLInputElement).value) };
	}
</script>

<div class="color-picker">
	<div class="tabs">
		<button type="button" class:active={mode === 'hsb'} onclick={() => (mode = 'hsb')}>HSB</button>
		<button type="button" class:active={mode === 'rgb'} onclick={() => (mode = 'rgb')}>RGB</button>
	</div>

	{#if mode === 'hsb'}
		<div
			class="sv-area"
			bind:this={svArea}
			style:--hue={hsb.h}
			role="slider"
			aria-label="채도/명도"
			aria-valuenow={Math.round(hsb.s)}
			tabindex="0"
			onpointerdown={handleSvPointerDown}
			onpointermove={handleSvPointerMove}
		>
			<div
				class="sv-thumb"
				style:left="{hsb.s}%"
				style:top="{100 - hsb.b}%"
				style:background={hex}
			></div>
		</div>

		<input
			class="hue-slider"
			type="range"
			min="0"
			max="360"
			value={hsb.h}
			oninput={handleHueInput}
			aria-label="색상(Hue)"
		/>
	{:else}
		<div class="rgb-sliders">
			<label>
				R
				<input
					type="range"
					min="0"
					max="255"
					value={rgb.r}
					oninput={(e) => setRgbChannel('r', Number((e.target as HTMLInputElement).value))}
				/>
				<span>{rgb.r}</span>
			</label>
			<label>
				G
				<input
					type="range"
					min="0"
					max="255"
					value={rgb.g}
					oninput={(e) => setRgbChannel('g', Number((e.target as HTMLInputElement).value))}
				/>
				<span>{rgb.g}</span>
			</label>
			<label>
				B
				<input
					type="range"
					min="0"
					max="255"
					value={rgb.b}
					oninput={(e) => setRgbChannel('b', Number((e.target as HTMLInputElement).value))}
				/>
				<span>{rgb.b}</span>
			</label>
		</div>
	{/if}

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
		width: 200px;
		padding: 10px;
		background: #2b2b2b;
		color: #eee;
		font-size: 12px;
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.tabs {
		display: flex;
		gap: 4px;
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

	.sv-area {
		position: relative;
		width: 100%;
		height: 140px;
		border-radius: 4px;
		touch-action: none;
		background:
			linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent),
			hsl(var(--hue), 100%, 50%);
	}

	.sv-thumb {
		position: absolute;
		width: 10px;
		height: 10px;
		border: 2px solid #fff;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.hue-slider {
		width: 100%;
		margin-top: 8px;
		appearance: none;
		height: 10px;
		border-radius: 5px;
		background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red);
	}

	.hue-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		border: 1px solid #333;
	}

	.rgb-sliders {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.rgb-sliders label {
		display: grid;
		grid-template-columns: 12px 1fr 28px;
		align-items: center;
		gap: 6px;
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
