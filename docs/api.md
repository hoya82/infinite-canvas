# 서버 API 스펙 — `.infcanvas` 내보내기 수신 서버

이 문서는 Infinite Canvas 클라이언트가 **선택적으로** 전송하는 "서버로 내보내기" 요청을 받을 서버를 구현하려는 사람(또는 AI 에이전트)을 위한 스펙입니다. Infinite Canvas 자체는 서버 없이 브라우저(OPFS + IndexedDB)만으로 완결되는 앱이므로, 이 API는 앱 동작에 필수가 아니라 "내가 그린 걸 내 서버에도 백업/전송하고 싶다"는 사용자를 위한 부가 기능입니다. 서버가 없어도 다운로드(로컬 파일 저장) 기능은 그대로 동작합니다.

구현체는 어떤 언어/프레임워크든 상관없습니다. 아래 스펙(요청 형식, CORS, 컨테이너 포맷)만 지키면 됩니다.

## 0. 클라이언트가 실제로 하는 일 (요약)

사용자가 클라이언트 UI(툴바 오른쪽의 "서버로 내보내기" 팝오버)에 엔드포인트 URL을 입력하고 "보내기"를 누르면, 클라이언트는:

1. 현재 도큐먼트를 즉시 한 번 저장하고(dirty 타일만 재인코딩),
2. 그렇게 만들어진 `.infcanvas` 컨테이너 전체를 **그대로** 그 URL에 `POST`합니다.

서버에 어떤 상태도 미리 만들어두지 않고, 인증도 클라이언트 쪽에서 자동으로 처리하지 않습니다(아래 "보안" 참고). 소스는 `src/lib/canvas/exportServer.ts`의 `exportDocumentToServer` 함수입니다.

## 1. 요청 스펙

| 항목                  | 값                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Method                | `POST`                                                                                                             |
| URL                   | 사용자가 클라이언트 UI에 직접 입력한 임의의 URL                                                                    |
| `Content-Type`        | `application/vnd.infcanvas+zip`                                                                                    |
| `Content-Disposition` | `attachment; filename="<제목>.infcanvas"` (제목은 `encodeURIComponent`로 인코딩됨)                                 |
| Body                  | `.infcanvas` 컨테이너의 **원본 바이트 그대로** (multipart/form-data 아님, JSON도 아님 — 요청 바디 자체가 zip 파일) |

`Content-Disposition`은 보통 응답 헤더로 쓰이지만, 여기서는 요청에 실어 서버가 저장할 때 쓸 파일명을 제안하는 용도로 얹었습니다. 신뢰하지 않아도 되고, 없어도 무방합니다(파일명은 어차피 컨테이너 안 `manifest.json`의 `title` 필드에도 들어 있습니다).

## 2. CORS 요구사항

이 요청은 브라우저에서 사용자가 지정한 임의의 오리진으로 보내는 크로스 오리진 요청입니다. `Content-Type`이 CORS의 "simple request" 허용 목록(`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`)에 없으므로 **반드시 프리플라이트(`OPTIONS`) 요청이 먼저 옵니다.** 서버는:

- `OPTIONS` 요청에 `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Content-Disposition`를 포함해 2xx로 응답해야 합니다.
- 실제 `POST` 응답에도 동일한 `Access-Control-Allow-Origin`을 포함해야 브라우저가 응답을 클라이언트 JS에 넘겨줍니다.

## 3. 응답 스펙

- **성공**: `2xx` 아무 코드나 무방합니다(클라이언트는 `response.ok`만 확인합니다). 바디는 클라이언트가 파싱하지 않으므로 자유 형식입니다.
- **실패**: `2xx`가 아니면 클라이언트는 예외를 던지고 UI에 "실패"를 표시합니다(`HTTP <status>`를 메시지에 포함).

## 4. `.infcanvas` 컨테이너 포맷

`.infcanvas`는 **zip 컨테이너**입니다. 압축은 전부 STORE(레벨 0, 무압축)로 되어 있으므로 표준 zip 라이브러리(또는 `unzip` 커맨드)면 특별한 처리 없이 그대로 풀립니다.

### 4.1 엔트리 구성

```
mimetype                              <- 반드시 첫 번째 엔트리, 무압축, ASCII "application/vnd.infcanvas+zip"
manifest.json                         <- UTF-8 JSON, 아래 4.2 스키마
tiles/{x}_{y}/{layerId}.webp          <- 타일 (x, y)의 레이어 layerId 픽셀. 512x512
textures/{textureId}.webp             <- 배경으로 쓰는 seamless 텍스처 이미지 (있는 경우만)
```

첫 엔트리가 이름 `mimetype`이고 무압축인 것은 ODF(OpenDocument)/EPUB이 쓰는 것과 같은 "매직 mimetype" 관례입니다 — 압축을 풀지 않고 zip의 첫 로컬 파일 헤더만 읽어도 파일 종류를 식별할 수 있습니다. 파일 검증 시 이 값을 확인하는 것을 권장합니다.

### 4.2 `manifest.json` 스키마

```ts
interface ContainerManifest {
	formatVersion: number; // 현재 1. 이후 스키마가 바뀌면 올라감 — 모르는 값이면 보수적으로 거부하거나 무시할 필드만 무시할 것
	title: string; // 도큐먼트 제목
	background: {
		type: 'color' | 'texture';
		color: string; // CSS 색상 문자열 (예: "#ffffff")
		textureId?: string; // type이 'texture'일 때, textures/{textureId}.webp를 가리킴
	};
	layers: Array<{
		id: string;
		name: string;
		mode: 'normal' | 'multiply';
		opacity: number; // 0~1
		visible: boolean;
		order: number; // 값이 클수록 스택 위(상단)
	}>;
	tiles: Array<{ x: number; y: number }>; // 실제로 존재하는(무언가 그려진) 타일 좌표 목록
	createdAt: number; // epoch ms
	updatedAt: number; // epoch ms
}
```

### 4.3 타일 좌표계

- 타일은 512×512 픽셀 정사각형이고, 정수 좌표 `(x, y)`로 인덱싱됩니다. 원점은 `(0, 0)`이며 음수 좌표도 유효합니다(무한히 사방으로 확장되는 캔버스이므로).
- 월드(도큐먼트) 픽셀 좌표로 환산하면 타일 `(x, y)`는 `[x*512, (x+1)*512) × [y*512, (y+1)*512)` 영역을 차지합니다.
- 타일은 sparse합니다 — `manifest.tiles`에 없는 좌표는 아무것도 그려지지 않은 빈 영역이며, 컨테이너에 해당 타일의 `.webp` 파일도 없습니다.
- 한 타일에는 `manifest.layers`에 있는 레이어 수만큼(0장~전체) `.webp` 파일이 있을 수 있습니다 — 어떤 레이어는 그 타일에서 비어 있을 수 있고, 그 경우 해당 (타일, 레이어) 조합의 파일 자체가 없습니다.

### 4.4 WebP 이미지에 대해

- 가능하면 무손실(브라우저가 `quality: 1.0`로 실제 무손실 인코딩을 지원하는 경우), 아니면 고품질 손실 모드(0.90~0.95대)로 인코딩되어 있습니다 — 어느 쪽이든 서버가 신경 쓸 필요는 없고, 그냥 유효한 `.webp` 파일로 저장/서빙하면 됩니다.
- 크기는 항상 512×512(타일)이거나, 텍스처의 경우 업로드된 원본 이미지 크기입니다.

## 5. 참고 구현 예시 (Bun.serve, 최소 동작 예시)

```ts
import { mkdir } from 'node:fs/promises';

const ALLOWED_ORIGIN = '*'; // 운영 환경에서는 신뢰할 오리진으로 좁힐 것
const corsHeaders = {
	'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Content-Disposition'
};

Bun.serve({
	port: 3001,
	async fetch(req) {
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}
		if (req.method !== 'POST') {
			return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
		}
		if (req.headers.get('content-type') !== 'application/vnd.infcanvas+zip') {
			return new Response('Unsupported Media Type', { status: 415, headers: corsHeaders });
		}

		const bytes = new Uint8Array(await req.arrayBuffer());
		// 필요하면 여기서 zip을 열어 mimetype/manifest.json을 검증한다.

		await mkdir('./uploads', { recursive: true });
		const filename = `upload-${Date.now()}.infcanvas`;
		await Bun.write(`./uploads/${filename}`, bytes);

		return new Response(JSON.stringify({ ok: true, filename }), {
			status: 201,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}
});
```

## 6. 보안 고려사항

- 클라이언트는 사용자가 입력한 URL로 파일을 그대로 전송할 뿐, 인증/인가 로직을 갖고 있지 않습니다. 인증이 필요하면 서버가 URL 자체에 토큰을 포함시키는 방식(예: `https://example.com/upload?token=...`) 등을 사용자가 직접 구성해야 합니다.
- 업로드 크기 제한, 레이트 리밋, 바이러스/악성 콘텐츠 검사 등은 전부 서버 구현자의 책임입니다.
- 저장 전 `mimetype` 엔트리 값과 `manifest.json`의 `formatVersion`을 확인해 이상한 파일을 걸러내는 것을 권장합니다.

## 7. 참고 소스

이 스펙의 최종 근거는 실제 클라이언트 코드입니다 — 구현 중 애매한 부분이 있으면 아래를 직접 확인하세요.

- `src/lib/canvas/exportServer.ts` — 요청을 실제로 만드는 코드
- `src/lib/canvas/container.ts` — 컨테이너 pack/unpack, manifest 타입 정의
- `src/lib/canvas/types.ts` — `TILE_SIZE` 등 기본 상수
