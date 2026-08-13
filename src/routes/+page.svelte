<script lang="ts">
	import { onMount } from 'svelte';
	import CanvasStage from '$lib/components/CanvasStage.svelte';
	import LayerPanel from '$lib/components/LayerPanel.svelte';
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { documentState } from '$lib/canvas/document.svelte';
	import { saveDocument, startAutosaveLoop } from '$lib/canvas/persistence';

	const AUTOSAVE_INTERVAL_MS = 30_000;

	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');

	async function manualSave(): Promise<void> {
		if (!documentState.doc || saveStatus === 'saving') return;
		saveStatus = 'saving';
		try {
			await saveDocument(documentState.doc.id, 'manual');
			saveStatus = 'saved';
			setTimeout(() => {
				if (saveStatus === 'saved') saveStatus = 'idle';
			}, 1500);
		} catch (err) {
			console.error('수동 저장 실패', err);
			saveStatus = 'idle';
		}
	}

	onMount(() => {
		documentState.load();

		function onKeydown(e: KeyboardEvent): void {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
				e.preventDefault();
				manualSave();
			}
		}
		window.addEventListener('keydown', onKeydown);

		const stopAutosave = startAutosaveLoop(
			() => documentState.doc?.id ?? null,
			AUTOSAVE_INTERVAL_MS
		);

		return () => {
			window.removeEventListener('keydown', onKeydown);
			stopAutosave();
		};
	});
</script>

<main>
	{#if documentState.loading}
		<p class="loading">불러오는 중…</p>
	{:else}
		<Toolbar />
		<div class="workspace">
			<div class="stage-area">
				<CanvasStage />
				<div class="save-status" class:visible={saveStatus !== 'idle'}>
					{saveStatus === 'saving' ? '저장 중…' : '저장됨'}
				</div>
			</div>
			<LayerPanel />
		</div>
	{/if}
</main>

<style>
	main {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
	}

	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.stage-area {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.save-status {
		position: absolute;
		top: 10px;
		left: 10px;
		padding: 4px 10px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-family: sans-serif;
		font-size: 12px;
		border-radius: 4px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.2s;
	}

	.save-status.visible {
		opacity: 1;
	}

	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
		font-family: sans-serif;
		color: #666;
	}
</style>
