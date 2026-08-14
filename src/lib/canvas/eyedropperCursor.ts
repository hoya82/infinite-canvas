/**
 * 스포이드 활성 상태의 캔버스 커서. 순정 CSS 키워드(crosshair)는 "지금 스포이드 모드"라는 것만
 * 알려줄 뿐 정확히 어느 픽셀을 뽑는지는 알려주지 않으므로, 커스텀 SVG 커서 + hotspot으로 스포이드
 * 끝부분(팁)이 실제로 클릭될 픽셀을 정확히 가리키게 한다.
 *
 * 아이콘 모양은 툴바 버튼과 같은 lucide `pipette` 아이콘의 path를 그대로 재사용한다(일관성).
 * 원본 24x24 뷰박스에서 "잉크가 떨어지는" 지점은 왼쪽 아래의 짧은 선분(`m2 22 .414-.414`)이
 * 시작하는 (2, 22)다 — 뷰박스에 -2 여백을 둬 흰색 halo stroke가 잘리지 않게 했고, 그만큼 hotspot도
 * (2,22)에서 (4,24)로 같이 옮겨 실제 클릭 좌표가 시각적 팁과 정확히 일치하게 한다.
 */

const PIPETTE_PATHS = [
	'm12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12',
	'm18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z',
	'm2 22 .414-.414'
];

function strokeGroup(color: string, width: number): string {
	const paths = PIPETTE_PATHS.map((d) => `<path d="${d}"/>`).join('');
	// 배경이 어떤 색이든(어두운 캔버스, 밝은 캔버스) 항상 보이도록, 굵은 흰 stroke 위에 검은 stroke를
	// 덧그리는 이중 테두리 기법 — Toolbar의 스워치/ColorPicker의 미리보기와 같은 방식이다
	return `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="-2 -2 28 28">${strokeGroup('#fff', 3.5)}${strokeGroup('#000', 2)}</svg>`;

/** CSS `cursor` 프로퍼티에 그대로 대입할 수 있는 값 (SVG 커서 로드 실패 시 crosshair로 폴백) */
export const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 4 24, crosshair`;
