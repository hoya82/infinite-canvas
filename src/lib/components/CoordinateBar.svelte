<script lang="ts">
	import Copy from 'lucide-svelte/icons/copy';
	import Navigation from 'lucide-svelte/icons/navigation';
	import Search from 'lucide-svelte/icons/search';
	import {
		buildAddressUrl,
		formatCoordinate,
		formatZoom,
		getViewportAddress,
		jumpToAddress,
		parseAddressInput,
		roundToTenth
	} from '$lib/canvas/coordinateAddress';
	import { activeViewport } from '$lib/canvas/viewport.svelte';

	// 필드에 뭔가 입력/붙여넣기를 하는 즉시 이동하지 않는다 — 사용자가 x/y/줌을 원하는 만큼
	// 미세조정할 여유를 주고, Enter나 "이동" 버튼을 눌렀을 때만 실제로 뷰포트를 옮긴다.
	// isDirty가 false인 동안에는 세 필드가 실시간 좌표를 그대로 따라가고, 한 글자라도 편집하면
	// isDirty가 true가 되어 그 순간부터는 커밋(이동)하거나 Escape로 취소할 때까지 입력값을 그대로 둔다.
	let isDirty = $state(false);
	let xInput = $state('');
	let yInput = $state('');
	let zoomInput = $state('');
	let pasteText = $state('');
	let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
	let jumpStatus = $state<'idle' | 'error'>('idle');

	const viewport = $derived(activeViewport.current);
	const liveAddress = $derived(viewport ? getViewportAddress(viewport) : null);

	$effect(() => {
		if (!isDirty && liveAddress) {
			xInput = formatCoordinate(liveAddress.x);
			yInput = formatCoordinate(liveAddress.y);
			zoomInput = formatZoom(liveAddress.zoom);
		}
	});

	function markDirty(): void {
		isDirty = true;
		jumpStatus = 'idle';
	}

	function handleXInput(e: Event): void {
		xInput = (e.target as HTMLInputElement).value;
		markDirty();
	}

	function handleYInput(e: Event): void {
		yInput = (e.target as HTMLInputElement).value;
		markDirty();
	}

	function handleZoomInput(e: Event): void {
		zoomInput = (e.target as HTMLInputElement).value;
		markDirty();
	}

	/** 지금 입력창(x/y/zoom)에 있는 값으로 실제 이동한다. 유효하지 않으면 아무 일도 하지 않는다 */
	function commitJump(): void {
		if (!viewport) return;

		const x = Number(xInput);
		const y = Number(yInput);
		const zoom = Number(zoomInput);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
			jumpStatus = 'error';
			return;
		}

		jumpToAddress(viewport, { x, y, zoom: roundToTenth(zoom) });
		isDirty = false; // 이동 후엔 다시 실시간 추적 모드로 — 방금 이동한 값과 실시간 값이 같으므로 자연스럽게 이어진다
		jumpStatus = 'idle';
		pasteText = '';
	}

	function cancelEdit(): void {
		isDirty = false;
		jumpStatus = 'idle';
	}

	function handleFieldKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitJump();
			(e.target as HTMLElement).blur();
		} else if (e.key === 'Escape') {
			cancelEdit();
			(e.target as HTMLElement).blur();
		}
	}

	async function handleCopy(): Promise<void> {
		if (!liveAddress) return;
		try {
			await navigator.clipboard.writeText(buildAddressUrl(liveAddress, window.location.href));
			copyStatus = 'copied';
		} catch (err) {
			console.error('좌표 URL 복사 실패', err);
			copyStatus = 'error';
		}
		setTimeout(() => {
			copyStatus = 'idle';
		}, 1200);
	}

	/**
	 * 붙여넣은 URL을 파싱해 x/y/zoom 입력창에 채워 넣기만 한다 — 곧바로 이동하지 않는다.
	 * 사용자가 파싱된 값을 보고 필요하면 고친 뒤, Enter나 "이동" 버튼으로 직접 커밋해야 한다.
	 */
	function handlePasteInput(e: Event): void {
		pasteText = (e.target as HTMLTextAreaElement).value;
		const parsed = parseAddressInput(pasteText);
		if (!parsed) return;

		xInput = formatCoordinate(parsed.x);
		yInput = formatCoordinate(parsed.y);
		zoomInput = formatZoom(parsed.zoom);
		isDirty = true;
		jumpStatus = 'idle';
	}

	function handlePasteAreaKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitJump();
		}
	}
</script>

{#if liveAddress}
	<div class="coordinate-bar">
		<div class="fields">
			<label class="field">
				<span class="axis">x</span>
				<input
					type="text"
					inputmode="decimal"
					value={xInput}
					oninput={handleXInput}
					onkeydown={handleFieldKeydown}
				/>
			</label>
			<label class="field">
				<span class="axis">y</span>
				<input
					type="text"
					inputmode="decimal"
					value={yInput}
					oninput={handleYInput}
					onkeydown={handleFieldKeydown}
				/>
			</label>
			<label class="field zoom">
				<Search size={12} />
				<input
					type="text"
					inputmode="decimal"
					value={zoomInput}
					oninput={handleZoomInput}
					onkeydown={handleFieldKeydown}
				/>
			</label>
			<button
				type="button"
				class:active={isDirty}
				aria-label="입력한 좌표로 이동"
				onclick={commitJump}
			>
				<Navigation size={14} />
			</button>
			<button type="button" aria-label="좌표 URL 복사" onclick={handleCopy}>
				<Copy size={14} />
			</button>
		</div>

		{#if jumpStatus === 'error'}
			<span class="status error">숫자로 된 x/y/줌 값이 필요합니다</span>
		{:else if copyStatus === 'copied'}
			<span class="status">복사됨</span>
		{:else if copyStatus === 'error'}
			<span class="status error">복사 실패</span>
		{/if}

		<textarea
			class="paste-area"
			placeholder="좌표 URL 붙여넣기"
			rows="1"
			value={pasteText}
			oninput={handlePasteInput}
			onkeydown={handlePasteAreaKeydown}></textarea>
	</div>
{/if}

<style>
	.coordinate-bar {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 8px 10px;
		background: #2b2b2b;
		color: #eee;
		font-size: 12px;
		border-bottom: 1px solid #444;
	}

	.fields {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 3px;
		min-width: 0;
		background: #1e1e1e;
		border: 1px solid #444;
		border-radius: 3px;
		padding: 2px 5px;
	}

	.field.zoom {
		flex: 0 0 50px;
	}

	.field:not(.zoom) {
		flex: 1;
	}

	.axis {
		opacity: 0.6;
		font-size: 11px;
	}

	.field input {
		width: 100%;
		min-width: 0;
		background: none;
		border: none;
		color: inherit;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		padding: 0;
	}

	.field input:focus {
		outline: none;
	}

	.fields button {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: #3a3a3a;
		border: none;
		border-radius: 3px;
		color: inherit;
		cursor: pointer;
	}

	/* 입력창에 아직 이동으로 반영되지 않은 값이 있음을 알린다 — 이동 버튼을 눌러야 적용된다 */
	.fields button.active {
		background: #5a7fbf;
	}

	.status {
		font-size: 11px;
		opacity: 0.8;
	}

	.status.error {
		color: #ff8080;
	}

	.paste-area {
		box-sizing: border-box;
		width: 100%;
		resize: none;
		background: #1e1e1e;
		border: 1px solid #444;
		color: inherit;
		font-size: 11px;
		padding: 4px 6px;
		border-radius: 3px;
	}
</style>
