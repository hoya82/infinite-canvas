<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import { documentState } from '$lib/canvas/document.svelte';
	import type { LayerMode } from '$lib/canvas/types';

	let editingLayerId = $state<string | null>(null);
	let editingName = $state('');

	// 패널에는 스택 상단이 위로 오도록 표시한다 (orderedLayers는 하단→상단)
	const topDownLayers = $derived(documentState.orderedLayers.slice().reverse());

	function selectLayer(layerId: string): void {
		documentState.activeLayerId = layerId;
	}

	function startRename(layerId: string, currentName: string): void {
		editingLayerId = layerId;
		editingName = currentName;
	}

	function commitRename(): void {
		if (editingLayerId) {
			documentState.renameLayer(editingLayerId, editingName);
		}
		editingLayerId = null;
	}

	function handleModeChange(layerId: string, e: Event): void {
		const value = (e.target as HTMLSelectElement).value as LayerMode;
		documentState.setLayerMode(layerId, value);
	}

	function handleOpacityChange(layerId: string, e: Event): void {
		const value = Number((e.target as HTMLInputElement).value) / 100;
		documentState.setLayerOpacity(layerId, value);
	}
</script>

<section class="layer-panel">
	<header>
		<h2>레이어</h2>
		<button type="button" onclick={() => documentState.addLayer()} aria-label="레이어 추가">
			<Plus size={16} />
		</button>
	</header>

	<ul>
		{#each topDownLayers as layer, i (layer.id)}
			<li class:active={layer.id === documentState.activeLayerId}>
				<button
					type="button"
					class="visibility"
					aria-label={layer.visible ? '레이어 숨기기' : '레이어 보이기'}
					onclick={() => documentState.setLayerVisible(layer.id, !layer.visible)}
				>
					{#if layer.visible}
						<Eye size={16} />
					{:else}
						<EyeOff size={16} />
					{/if}
				</button>

				<div
					class="body"
					role="button"
					tabindex="0"
					aria-pressed={layer.id === documentState.activeLayerId}
					onclick={() => selectLayer(layer.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							selectLayer(layer.id);
						}
					}}
				>
					{#if editingLayerId === layer.id}
						<input
							class="name-input"
							bind:value={editingName}
							onblur={commitRename}
							onkeydown={(e) => e.key === 'Enter' && commitRename()}
						/>
					{:else}
						<span
							class="name"
							role="button"
							tabindex="0"
							ondblclick={() => startRename(layer.id, layer.name)}
							onkeydown={(e) => e.key === 'F2' && startRename(layer.id, layer.name)}
						>
							{layer.name}
						</span>
					{/if}

					<div class="row">
						<select value={layer.mode} onchange={(e) => handleModeChange(layer.id, e)}>
							<option value="normal">Normal</option>
							<option value="multiply">Multiply</option>
						</select>
						<input
							type="range"
							min="0"
							max="100"
							value={Math.round(layer.opacity * 100)}
							oninput={(e) => handleOpacityChange(layer.id, e)}
						/>
						<span class="opacity-value">{Math.round(layer.opacity * 100)}%</span>
					</div>
				</div>

				<div class="actions">
					<button
						type="button"
						aria-label="위로 이동"
						disabled={i === 0}
						onclick={() => documentState.moveLayer(layer.id, 'up')}
					>
						<ChevronUp size={14} />
					</button>
					<button
						type="button"
						aria-label="아래로 이동"
						disabled={i === topDownLayers.length - 1}
						onclick={() => documentState.moveLayer(layer.id, 'down')}
					>
						<ChevronDown size={14} />
					</button>
					<button
						type="button"
						aria-label="레이어 삭제"
						disabled={documentState.layers.length <= 1}
						onclick={() => documentState.removeLayer(layer.id)}
					>
						<Trash2 size={14} />
					</button>
				</div>
			</li>
		{/each}
	</ul>
</section>

<style>
	.layer-panel {
		display: flex;
		flex-direction: column;
		width: 260px;
		overflow-x: hidden;
		background: #2b2b2b;
		color: #eee;
		font-size: 13px;
		border-left: 1px solid #444;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
		border-bottom: 1px solid #444;
	}

	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	header button {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		display: flex;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		/* overflow-y만 지정하면 overflow-x가 암묵적으로 auto로 승격되는 CSS 규칙 때문에
		   불필요한 가로 스크롤바가 생긴다 — 명시적으로 막는다 */
		overflow-x: hidden;
	}

	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-bottom: 1px solid #3a3a3a;
	}

	li.active {
		background: #3a5a8c;
	}

	.visibility {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		display: flex;
	}

	.body {
		flex: 1;
		min-width: 0;
		cursor: pointer;
	}

	.name {
		display: block;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.name-input {
		width: 100%;
		box-sizing: border-box;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 2px;
	}

	.row select {
		/* flex item의 기본 min-width:auto는 내용물(예: "Multiply") 너비 아래로 못 줄어들게 막아
		   패널 가로 스크롤의 원인이 된다 — 명시적으로 풀어주고 폭을 좁게 고정한다 */
		flex: 0 0 62px;
		min-width: 0;
		width: 62px;
		font-size: 10px;
	}

	.row input[type='range'] {
		flex: 1;
		min-width: 0;
	}

	.opacity-value {
		font-variant-numeric: tabular-nums;
		width: 32px;
		text-align: right;
		font-size: 11px;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.actions button {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		display: flex;
		padding: 1px;
	}

	.actions button:disabled {
		opacity: 0.3;
		cursor: default;
	}
</style>
