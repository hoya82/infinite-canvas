/** 현재 도구(펜/지우개)와 각 도구별 독립된 크기, 전경색의 반응형 상태 */
import type { Tool } from './types';

export class ToolState {
	tool = $state<Tool>('brush');
	/** 지름(px), 펜/지우개 각각 별도 상태 */
	brushSize = $state(24);
	eraserSize = $state(40);
	/** 전경색, hex (#rrggbb) — M6에서 컬러 피커와 연결 */
	color = $state('#1a1a1a');

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
}

export const toolState = new ToolState();
