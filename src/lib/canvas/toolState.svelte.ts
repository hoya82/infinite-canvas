/** 현재 도구(펜/지우개)와 각 도구별 독립된 크기, 전경색의 반응형 상태 */
import type { Tool } from './types';

/** 컬러 히스토리 팔레트에 쌓아둘 최대 색상 수 — 무한정 늘어나 팝오버를 넘치게 하지 않도록 제한 */
const COLOR_HISTORY_LIMIT = 40;

export class ToolState {
	tool = $state<Tool>('brush');
	/** 지름(px), 펜/지우개 각각 별도 상태 */
	brushSize = $state(24);
	eraserSize = $state(40);
	/** 전경색, hex (#rrggbb) — M6에서 컬러 피커와 연결 */
	color = $state('#1a1a1a');
	/** 컬러 피커에서 실제로 확정(commit)한 색의 최근 사용 목록, 최신이 앞. 팝오버를 닫아도 유지되도록
	 *  컴포넌트가 아닌 이 싱글톤에 둔다 */
	colorHistory = $state<string[]>([]);
	/** Space 없이 Ctrl만 누르고 있어(input.ts의 baseMode 'eyedropper') 스포이드가 일시적으로 활성화된
	 *  상태인지 — CanvasStage가 갱신하고 Toolbar가 스포이드 버튼 강조 표시에 읽는다 */
	eyedropperKeyHeld = $state(false);

	get activeSize(): number {
		return this.tool === 'eraser' ? this.eraserSize : this.brushSize;
	}

	set activeSize(value: number) {
		if (this.tool === 'eraser') this.eraserSize = value;
		else this.brushSize = value;
	}

	toggleTool(): void {
		this.tool = this.tool === 'eraser' ? 'brush' : 'eraser';
	}

	/** 정확히 같은 색이 이미 있으면 아무것도 하지 않는다(중복 스택 방지) */
	addColorToHistory(hex: string): void {
		const normalized = hex.toLowerCase();
		if (this.colorHistory.includes(normalized)) return;
		this.colorHistory = [normalized, ...this.colorHistory].slice(0, COLOR_HISTORY_LIMIT);
	}
}

export const toolState = new ToolState();
