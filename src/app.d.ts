// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// File System Access API의 저장 대화상자 부분은 현재 TS DOM lib에 아직 없어 직접 선언한다.
	// (FileSystemFileHandle/FileSystemDirectoryHandle 자체는 이미 lib.dom에 있다 — src/lib/canvas/opfs.ts 참고)
	interface SaveFilePickerOptions {
		suggestedName?: string;
		types?: Array<{ description?: string; accept: Record<string, string[]> }>;
	}

	interface Window {
		showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
	}
}

export {};
