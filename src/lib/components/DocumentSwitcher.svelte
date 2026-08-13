<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import FileImage from 'lucide-svelte/icons/file-image';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import { createDocument } from '$lib/canvas/bootstrap';
	import { documentState } from '$lib/canvas/document.svelte';
	import {
		deleteDocument,
		listDocumentSummaries,
		renameDocument,
		type DocumentSummary
	} from '$lib/canvas/documentManager';

	let open = $state(false);
	let summaries = $state<DocumentSummary[]>([]);
	let editingId = $state<string | null>(null);
	let editingTitle = $state('');
	let newTitle = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	async function refresh(): Promise<void> {
		summaries = await listDocumentSummaries();
	}

	async function toggle(): Promise<void> {
		open = !open;
		if (open) await refresh();
	}

	async function openDocument(id: string): Promise<void> {
		if (id !== documentState.doc?.id) {
			await documentState.load(id);
		}
		open = false;
	}

	function startRename(id: string, title: string): void {
		editingId = id;
		editingTitle = title;
	}

	async function commitRename(id: string): Promise<void> {
		const title = editingTitle.trim();
		editingId = null;
		if (!title) return;
		await renameDocument(id, title);
		if (id === documentState.doc?.id) await documentState.load(id);
		await refresh();
	}

	async function removeDocument(id: string): Promise<void> {
		const wasActive = id === documentState.doc?.id;
		await deleteDocument(id);
		if (wasActive) await documentState.load();
		await refresh();
	}

	async function submitCreate(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		const title = newTitle.trim();
		if (!title) return;
		const doc = await createDocument(title);
		newTitle = '';
		await documentState.load(doc.id);
		open = false;
	}

	function handleBackgroundColorInput(e: Event): void {
		documentState.setBackgroundColor((e.target as HTMLInputElement).value);
	}

	function handleTextureFileChange(e: Event): void {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) documentState.setBackgroundTexture(file);
		if (fileInput) fileInput.value = '';
	}
</script>

<div class="switcher">
	<button type="button" class="trigger" onclick={toggle}>
		<span class="title">{documentState.doc?.title ?? '문서 없음'}</span>
		<ChevronDown size={14} />
	</button>

	{#if open}
		<div class="panel">
			<ul>
				{#each summaries as summary (summary.id)}
					<li class:active={summary.id === documentState.doc?.id}>
						{#if editingId === summary.id}
							<input
								class="rename-input"
								bind:value={editingTitle}
								onblur={() => commitRename(summary.id)}
								onkeydown={(e) => e.key === 'Enter' && commitRename(summary.id)}
							/>
						{:else}
							<button
								type="button"
								class="doc-name"
								ondblclick={() => startRename(summary.id, summary.title)}
								onclick={() => openDocument(summary.id)}
							>
								{summary.title}
							</button>
						{/if}
						<button
							type="button"
							class="delete"
							aria-label="문서 삭제"
							onclick={() => removeDocument(summary.id)}
						>
							<Trash2 size={12} />
						</button>
					</li>
				{/each}
			</ul>

			<form class="create-row" onsubmit={submitCreate}>
				<input placeholder="새 도큐먼트 이름" bind:value={newTitle} />
				<button type="submit" aria-label="도큐먼트 만들기"><Plus size={14} /></button>
			</form>

			{#if documentState.doc}
				<div class="background-settings">
					<span class="section-label">배경</span>
					<div class="background-row">
						<input
							type="color"
							value={documentState.doc.background.color}
							oninput={handleBackgroundColorInput}
						/>
						<button
							type="button"
							class="texture-button"
							onclick={() => fileInput?.click()}
							aria-label="배경 텍스처 업로드"
						>
							<FileImage size={14} />
						</button>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/*"
							class="hidden-file-input"
							onchange={handleTextureFileChange}
						/>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.switcher {
		position: relative;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: 6px;
		background: #3a3a3a;
		border: none;
		color: #eee;
		padding: 5px 10px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		max-width: 180px;
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.panel {
		position: absolute;
		top: 34px;
		left: 0;
		width: 220px;
		background: #2b2b2b;
		color: #eee;
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		z-index: 10;
		font-size: 12px;
		overflow: hidden;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 4px;
		max-height: 220px;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: center;
		border-radius: 3px;
	}

	li.active {
		background: #3a5a8c;
	}

	.doc-name {
		flex: 1;
		text-align: left;
		background: none;
		border: none;
		color: inherit;
		padding: 5px 6px;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.rename-input {
		flex: 1;
		margin: 2px;
		box-sizing: border-box;
	}

	.delete {
		background: none;
		border: none;
		color: inherit;
		padding: 4px;
		cursor: pointer;
		display: flex;
		opacity: 0.6;
	}

	.delete:hover {
		opacity: 1;
	}

	.create-row {
		display: flex;
		gap: 4px;
		padding: 6px;
		border-top: 1px solid #444;
	}

	.create-row input {
		flex: 1;
		box-sizing: border-box;
		background: #1e1e1e;
		border: 1px solid #444;
		color: inherit;
		padding: 3px 6px;
		border-radius: 3px;
	}

	.create-row button {
		background: #3a3a3a;
		border: none;
		color: inherit;
		border-radius: 3px;
		display: flex;
		align-items: center;
		padding: 0 6px;
		cursor: pointer;
	}

	.background-settings {
		padding: 6px;
		border-top: 1px solid #444;
	}

	.section-label {
		display: block;
		margin-bottom: 4px;
		opacity: 0.7;
	}

	.background-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.texture-button {
		background: #3a3a3a;
		border: none;
		color: inherit;
		border-radius: 3px;
		display: flex;
		align-items: center;
		padding: 5px;
		cursor: pointer;
	}

	.hidden-file-input {
		display: none;
	}
</style>
