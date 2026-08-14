import { expect, test, type Page } from '@playwright/test';

type RGBA = [number, number, number, number];

async function canvasPoint(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
	const box = await page.locator('.canvas-stage canvas').boundingBox();
	if (!box) throw new Error('canvas element not found');
	return { x: box.x + dx, y: box.y + dy };
}

async function drawStroke(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number }
): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

/** 화면 좌표(CSS px)를 캔버스 내부 픽셀로 환산해 합성된 최종 색상을 읽는다. 배경은 항상 불투명하게
 *  먼저 칠해지므로(renderer.ts) 알파값이 아니라 RGB로 "칠해졌는지/지워졌는지"를 판단해야 한다. */
async function samplePixel(page: Page, x: number, y: number): Promise<RGBA> {
	return page.evaluate(
		({ x, y }) => {
			const canvas = document.querySelector('.canvas-stage canvas') as HTMLCanvasElement;
			const rect = canvas.getBoundingClientRect();
			const scaleX = canvas.width / rect.width;
			const scaleY = canvas.height / rect.height;
			const ctx = canvas.getContext('2d')!;
			const px = Math.min(canvas.width - 1, Math.max(0, Math.floor((x - rect.left) * scaleX)));
			const py = Math.min(canvas.height - 1, Math.max(0, Math.floor((y - rect.top) * scaleY)));
			const data = ctx.getImageData(px, py, 1, 1).data;
			return [data[0], data[1], data[2], data[3]] as [number, number, number, number];
		},
		{ x, y }
	);
}

test.describe('Infinite Canvas', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.toolbar')).toBeVisible();
		await expect(page.locator('.canvas-stage canvas')).toBeVisible();
	});

	test('처음 열면 기본 문서("Canvas")와 레이어("레이어 1")가 준비된 상태로 로드된다', async ({ page }) => {
		await expect(page.locator('.toolbar .trigger .title')).toHaveText('Canvas');
		await expect(page.getByRole('button', { name: '펜' })).toHaveClass(/active/);
		await expect(page.locator('.layer-panel li')).toHaveCount(1);
		await expect(page.locator('.layer-panel li .name')).toHaveText('레이어 1');
	});

	test('펜으로 캔버스를 그으면 실제로 픽셀이 칠해진다', async ({ page }) => {
		const start = await canvasPoint(page, 150, 150);
		const before = await samplePixel(page, start.x, start.y);
		expect(before[0]).toBeGreaterThan(240); // 기본 배경은 흰색

		const end = await canvasPoint(page, 220, 150);
		await drawStroke(page, start, end);

		const mid = await canvasPoint(page, 185, 150);
		const after = await samplePixel(page, mid.x, mid.y);
		// 기본 전경색은 #1a1a1a
		expect(after[0]).toBeLessThan(80);
		expect(after[1]).toBeLessThan(80);
		expect(after[2]).toBeLessThan(80);
	});

	test('지우개로 칠한 부분을 지우면 배경색으로 돌아간다', async ({ page }) => {
		const start = await canvasPoint(page, 150, 300);
		const end = await canvasPoint(page, 220, 300);
		const mid = await canvasPoint(page, 185, 300);

		await drawStroke(page, start, end);
		const painted = await samplePixel(page, mid.x, mid.y);
		expect(painted[0]).toBeLessThan(80);

		await page.getByRole('button', { name: '지우개' }).click();
		await drawStroke(page, start, end);

		const erased = await samplePixel(page, mid.x, mid.y);
		expect(erased[0]).toBeGreaterThan(240);
		expect(erased[1]).toBeGreaterThan(240);
		expect(erased[2]).toBeGreaterThan(240);
	});

	test("단축키 'E'로 펜/지우개 도구가 토글된다", async ({ page }) => {
		const pen = page.getByRole('button', { name: '펜' });
		const eraser = page.getByRole('button', { name: '지우개' });
		await expect(pen).toHaveClass(/active/);

		await page.keyboard.press('e');
		await expect(eraser).toHaveClass(/active/);

		await page.keyboard.press('e');
		await expect(pen).toHaveClass(/active/);
	});

	test('레이어를 추가하면 목록에 나타나고 새 레이어가 곧바로 활성화된다', async ({ page }) => {
		await expect(page.locator('.layer-panel li')).toHaveCount(1);

		await page.getByRole('button', { name: '레이어 추가' }).click();

		await expect(page.locator('.layer-panel li')).toHaveCount(2);
		await expect(page.locator('.layer-panel li.active .name')).toHaveText('레이어 2');
	});

	test('레이어 투명도 슬라이더를 조절하면 표시 퍼센트가 즉시 갱신된다', async ({ page }) => {
		const opacitySlider = page.locator('.layer-panel li .row input[type="range"]');
		await opacitySlider.fill('40');
		await expect(page.locator('.layer-panel li .opacity-value')).toHaveText('40%');
	});

	test('컬러 피커에서 hex 값을 바꾸면 전경색 스와치와 실제로 그려지는 색이 함께 바뀐다', async ({ page }) => {
		await page.getByRole('button', { name: '전경색 선택' }).click();
		const hexInput = page.locator('.picker-popover .hex-input');
		await hexInput.fill('ff0000');
		await hexInput.press('Enter');
		await expect(page.locator('.toolbar .swatch-fill')).toHaveCSS(
			'background-color',
			'rgb(255, 0, 0)'
		);
		await page.getByRole('button', { name: '전경색 선택' }).click(); // 팝오버 닫기(캔버스 가림 방지)

		const start = await canvasPoint(page, 150, 400);
		const end = await canvasPoint(page, 220, 400);
		await drawStroke(page, start, end);

		const mid = await canvasPoint(page, 185, 400);
		const pixel = await samplePixel(page, mid.x, mid.y);
		expect(pixel[0]).toBeGreaterThan(200);
		expect(pixel[1]).toBeLessThan(60);
		expect(pixel[2]).toBeLessThan(60);
	});

	test('Ctrl+S로 수동 저장하면 저장 상태 표시가 나타난다', async ({ page }) => {
		await expect(page.locator('.save-status')).not.toHaveClass(/visible/);
		await page.keyboard.press('Control+s');
		await expect(page.locator('.save-status.visible')).toHaveText(/저장/);
	});

	test('그린 내용은 저장 후 새로고침해도 유지된다 (OPFS 영속성)', async ({ page }) => {
		const start = await canvasPoint(page, 150, 450);
		const end = await canvasPoint(page, 220, 450);
		await drawStroke(page, start, end);

		await page.keyboard.press('Control+s');
		await expect(page.locator('.save-status')).toHaveText('저장됨', { timeout: 10_000 });

		await page.reload();
		await expect(page.locator('.toolbar')).toBeVisible();
		await expect(page.locator('.canvas-stage canvas')).toBeVisible();

		const mid = await canvasPoint(page, 185, 450);
		await expect
			.poll(async () => (await samplePixel(page, mid.x, mid.y))[0], { timeout: 10_000 })
			.toBeLessThan(80);
	});
});
