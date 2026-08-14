<script lang="ts">
	import CloudUpload from 'lucide-svelte/icons/cloud-upload';
	import Download from 'lucide-svelte/icons/download';
	import EraserIcon from 'lucide-svelte/icons/eraser';
	import PencilIcon from 'lucide-svelte/icons/pencil';
	import PipetteIcon from 'lucide-svelte/icons/pipette';
	import ColorPicker from './ColorPicker.svelte';
	import DocumentSwitcher from './DocumentSwitcher.svelte';
	import { documentState } from '$lib/canvas/document.svelte';
	import { downloadDocument, exportDocumentToServer } from '$lib/canvas/exportServer';
	import { toolState } from '$lib/canvas/toolState.svelte';

	let pickerOpen = $state(false);
	let exportOpen = $state(false);
	let endpointUrl = $state('');
	let exportStatus = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');

	async function handleDownload(): Promise<void> {
		if (!documentState.doc) return;
		await downloadDocument(documentState.doc.id);
	}

	async function submitExport(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!documentState.doc || !endpointUrl.trim()) return;
		exportStatus = 'sending';
		try {
			await exportDocumentToServer(documentState.doc.id, endpointUrl.trim());
			exportStatus = 'sent';
		} catch (err) {
			console.error('서버 내보내기 실패', err);
			exportStatus = 'error';
		}
	}
</script>

<div class="toolbar">
	<div class="left-group">
		<DocumentSwitcher />
		<button
			type="button"
			class:active={toolState.tool === 'brush'}
			aria-label="펜"
			onclick={() => (toolState.tool = 'brush')}
		>
			<PencilIcon size={18} />
		</button>
		<button
			type="button"
			class:active={toolState.tool === 'eraser'}
			aria-label="지우개"
			onclick={() => (toolState.tool = 'eraser')}
		>
			<EraserIcon size={18} />
		</button>
		<button
			type="button"
			class:active={toolState.tool === 'eyedropper' || toolState.eyedropperKeyHeld}
			aria-label="스포이드"
			onclick={() => (toolState.tool = 'eyedropper')}
		>
			<PipetteIcon size={18} />
		</button>

		{#if toolState.tool !== 'eyedropper'}
			<label class="size">
				{toolState.tool === 'eraser' ? '지우개 크기' : '펜 크기'}
				<input
					type="range"
					min="1"
					max="200"
					value={toolState.activeSize}
					oninput={(e) => (toolState.activeSize = Number((e.target as HTMLInputElement).value))}
				/>
				<span>{toolState.activeSize}px</span>
			</label>
		{/if}
	</div>

	<div class="center-group">
		<div class="swatch-wrap">
			<button
				type="button"
				class="swatch"
				aria-label="전경색 선택"
				onclick={() => (pickerOpen = !pickerOpen)}
			>
				<span class="swatch-fill" style:background={toolState.color}></span>
			</button>
			{#if pickerOpen}
				<div class="picker-popover">
					<ColorPicker />
				</div>
			{/if}
		</div>
	</div>

	<div class="right-group">
		<button type="button" aria-label="다운로드" onclick={handleDownload}>
			<Download size={18} />
		</button>

		<div class="export-wrap">
			<button type="button" aria-label="서버로 내보내기" onclick={() => (exportOpen = !exportOpen)}>
				<CloudUpload size={18} />
			</button>
			{#if exportOpen}
				<form class="export-popover" onsubmit={submitExport}>
					<input type="url" placeholder="https://..." bind:value={endpointUrl} required />
					<button type="submit">보내기</button>
					{#if exportStatus === 'sending'}
						<span class="status">전송 중…</span>
					{:else if exportStatus === 'sent'}
						<span class="status">완료</span>
					{:else if exportStatus === 'error'}
						<span class="status error">실패</span>
					{/if}
				</form>
			{/if}
		</div>
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		background: #232323;
		color: #eee;
		font-family: sans-serif;
		font-size: 12px;
	}

	.toolbar button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		background: #3a3a3a;
		border: none;
		border-radius: 4px;
		color: inherit;
		cursor: pointer;
	}

	.toolbar button.active {
		background: #5a7fbf;
	}

	.left-group {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.center-group {
		display: flex;
		justify-content: center;
	}

	.right-group {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	.size {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.size span {
		width: 34px;
		font-variant-numeric: tabular-nums;
	}

	.export-wrap {
		position: relative;
	}

	.export-popover {
		position: absolute;
		top: 34px;
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 6px;
		width: 220px;
		padding: 10px;
		background: #2b2b2b;
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
	}

	.export-popover input {
		box-sizing: border-box;
		background: #1e1e1e;
		border: 1px solid #444;
		color: inherit;
		padding: 4px 6px;
		border-radius: 3px;
	}

	.export-popover button[type='submit'] {
		width: auto;
		height: auto;
		padding: 5px 0;
	}

	.status {
		font-size: 11px;
		opacity: 0.8;
	}

	.status.error {
		color: #ff8080;
	}

	.swatch-wrap {
		position: relative;
	}

	/*
	 * 스워치는 세 겹으로 구성한다: 바깥쪽 흰색 굵은 테두리(패딩+흰 배경) -> 그 안쪽 검은 얇은 선
	 * -> 실제 선택 색상. 흰 테두리는 어두운 배경에서, 검은 선은 흰색/밝은 선택색에서 각각 대비를
	 * 보장하므로 어떤 색을 골라도(검정 포함) 스워치 경계가 항상 보인다.
	 */
	.swatch {
		width: 28px;
		height: 28px;
		padding: 3px;
		background: #fff;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}

	.swatch-fill {
		display: block;
		width: 100%;
		height: 100%;
		border: 1px solid #000;
		border-radius: 3px;
		box-sizing: border-box;
	}

	/* 팝업은 스워치 아이콘에 그대로 anchor된다 (아이콘이 어디 있든 그 바로 아래 중앙) */
	.picker-popover {
		position: absolute;
		top: 34px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
	}
</style>
