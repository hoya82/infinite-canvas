# 서버 API 스펙 — `.infcanvas` 저장/불러오기 서버

이 문서는 Infinite Canvas 클라이언트가 **선택적으로** 연결하는 "서버와 링크하기" 기능을 받을 서버를 구현하려는 사람(또는 AI 에이전트)을 위한 스펙입니다. Infinite Canvas 자체는 서버 없이 브라우저(OPFS + IndexedDB)만으로 완결되는 앱이므로, 이 API는 앱 동작에 필수가 아니라 "내가 그린 걸 내 서버에도 자동 백업하고, 다른 브라우저/기기에서도 불러오고 싶다"는 사용자를 위한 부가 기능입니다. 서버가 없어도 로컬 저장/다운로드 기능은 그대로 동작합니다.

구현체는 어떤 언어/프레임워크든 상관없습니다. 아래 스펙(요청 형식, CORS, 컨테이너 포맷)만 지키면 됩니다.

## 0. 클라이언트가 실제로 하는 일 (요약)

사용자가 클라이언트 UI(툴바의 링크 아이콘 팝오버)에 URL을 입력하고 "링크하기"를 누르면, 클라이언트는 그 **URL 자체를 이 도큐먼트의 고유 리소스 주소**로 취급합니다(서버가 여러 경로를 지원하면 사용자가 도큐먼트마다 다른 경로를 골라 여러 캔버스를 구분해 저장할 수 있습니다 — 예: `https://my.example.com/canvases/sketch-1`, `.../sketch-2`).

- **링크하기**: 먼저 그 URL에 `GET`을 보내 이미 저장된 캔버스가 있는지 확인합니다.
  - 있으면(200) 사용자에게 "로컬 내용을 덮어쓰고 불러올지" 확인 후, 승인하면 그 컨테이너로 로컬 도큐먼트를 교체합니다.
  - 없으면(404) 현재 로컬 도큐먼트를 그 URL에 즉시 `PUT`해 링크를 확립합니다.
- **자동저장**: 링크되어 있는 동안 10분 간격으로, 그사이 변경된 내용이 있으면 같은 URL에 `PUT`합니다. 자동저장은 그리기 동작을 블로킹하지 않습니다 — 저장 시점의 dirty 타일만 원자적으로 스냅샷 떠서 인코딩/전송하고, 그 이후의 새 스트로크는 다음 자동저장 사이클로 자연스럽게 넘어갑니다.
- **불러오기**: 링크된 상태에서 사용자가 언제든 수동으로 "불러오기"를 눌러 서버의 최신 스냅샷을 다시 받아올 수 있습니다(역시 로컬 내용을 덮어쓰므로 확인을 거칩니다).
- **연결 해제**: 로컬에서 URL 연결 정보만 지웁니다. 서버에 저장된 데이터를 지우거나 서버에 별도로 알리지 않습니다.

소스는 `src/lib/canvas/serverLink.ts`입니다.

## 1. 요청 스펙

같은 URL에 대해 메서드 두 가지만 씁니다 — **경로당 하나의 최신 스냅샷만 유지하는 upsert 방식**이며, 업로드 이력을 쌓지 않습니다.

### 1.1 저장 — `PUT {url}`

| 항목           | 값                                                                        |
| -------------- | ------------------------------------------------------------------------- |
| Method         | `PUT`                                                                     |
| URL            | 사용자가 클라이언트 UI에 직접 입력한 임의의 URL                           |
| `Content-Type` | `application/vnd.infcanvas+zip`                                           |
| Body           | `.infcanvas` 컨테이너의 **원본 바이트 그대로** (JSON도, multipart도 아님) |

같은 URL에 다시 `PUT`하면 이전 내용을 완전히 대체합니다(덮어쓰기, 이력 보관 없음).

### 1.2 불러오기 — `GET {url}`

| 항목      | 값                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| Method    | `GET`                                                                                                        |
| URL       | 저장할 때와 동일한 URL                                                                                       |
| 성공(200) | Body는 그 URL에 마지막으로 `PUT`된 `.infcanvas` 바이트 그대로, `Content-Type: application/vnd.infcanvas+zip` |
| 없음(404) | 그 URL에 아직 아무것도 저장된 적이 없음 — 클라이언트는 이를 오류가 아니라 "새로 링크함"으로 처리합니다       |

## 2. CORS 요구사항

이 요청은 브라우저에서 사용자가 지정한 임의의 오리진으로 보내는 크로스 오리진 요청입니다. `PUT`과, `Content-Type`이 CORS "simple request" 허용 목록에 없는 점 때문에 **반드시 프리플라이트(`OPTIONS`) 요청이 먼저 옵니다.** 서버는:

- `OPTIONS` 요청에 `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, PUT, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`을 포함해 2xx로 응답해야 합니다.
- 실제 `GET`/`PUT` 응답에도 동일한 `Access-Control-Allow-Origin`을 포함해야 브라우저가 응답을 클라이언트 JS에 넘겨줍니다.

## 3. 응답 스펙

- **PUT 성공**: `2xx` 아무 코드나 무방합니다(클라이언트는 `response.ok`만 확인합니다). 바디는 클라이언트가 파싱하지 않으므로 자유 형식입니다.
- **PUT 실패**: `2xx`가 아니면 클라이언트는 예외를 던지고 UI에 "실패"를 표시합니다(`HTTP <status>`를 메시지에 포함).
- **GET**: `200`이면 바디를 그대로 `.infcanvas` 컨테이너로 취급해 불러옵니다. `404`는 "아직 저장 안 됨"으로 처리합니다(에러 아님). 그 외 실패 코드는 PUT과 동일하게 예외로 처리합니다.

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

경로별로 최신 스냅샷 하나만 upsert하는 최소 구현입니다. 실제로 이 저장소의 `server/`가 정확히 이 스펙을 구현합니다(경로를 파일명으로 안전하게 매핑하는 부분 등은 `server/src/storage.ts` 참고).

```ts
import { mkdir } from 'node:fs/promises';

const ALLOWED_ORIGIN = '*'; // 운영 환경에서는 신뢰할 오리진으로 좁힐 것
const corsHeaders = {
	'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
	'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

function pathToFilename(pathname: string): string {
	const safe = pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
	return `${safe || 'root'}.infcanvas`;
}

Bun.serve({
	port: 3001,
	async fetch(req) {
		const url = new URL(req.url);
		const filePath = `./uploads/${pathToFilename(url.pathname)}`;

		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		if (req.method === 'GET') {
			const file = Bun.file(filePath);
			if (!(await file.exists())) {
				return new Response(JSON.stringify({ ok: false }), {
					status: 404,
					headers: { ...corsHeaders, 'Content-Type': 'application/json' }
				});
			}
			return new Response(file, {
				headers: { ...corsHeaders, 'Content-Type': 'application/vnd.infcanvas+zip' }
			});
		}

		if (req.method !== 'PUT') {
			return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
		}
		if (req.headers.get('content-type') !== 'application/vnd.infcanvas+zip') {
			return new Response('Unsupported Media Type', { status: 415, headers: corsHeaders });
		}

		const bytes = new Uint8Array(await req.arrayBuffer());
		// 필요하면 여기서 zip을 열어 mimetype/manifest.json을 검증한다.

		await mkdir('./uploads', { recursive: true });
		await Bun.write(filePath, bytes);

		return new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' }
		});
	}
});
```

## 6. 보안 고려사항

- 클라이언트는 사용자가 입력한 URL로 파일을 그대로 읽고/쓸 뿐, 인증/인가 로직을 갖고 있지 않습니다. 인증이 필요하면 서버가 URL 자체에 토큰을 포함시키는 방식(예: `https://example.com/canvases/sketch-1?token=...`) 등을 사용자가 직접 구성해야 합니다.
- 아무 경로에나 `PUT`할 수 있으므로, 인증 없이 공개 배포한다면 누구나 임의 경로에 쓰거나 읽을 수 있습니다. 서버 구현자가 경로 화이트리스트나 토큰 검증 등을 추가하는 것을 권장합니다.
- 업로드 크기 제한, 레이트 리밋, 바이러스/악성 콘텐츠 검사 등은 전부 서버 구현자의 책임입니다.
- 저장 전 `mimetype` 엔트리 값과 `manifest.json`의 `formatVersion`을 확인해 이상한 파일을 걸러내는 것을 권장합니다.

## 7. 참고 소스

이 스펙의 최종 근거는 실제 클라이언트 코드입니다 — 구현 중 애매한 부분이 있으면 아래를 직접 확인하세요.

- `src/lib/canvas/serverLink.ts` — 링크/자동저장/불러오기 요청을 실제로 만드는 코드
- `src/lib/canvas/containerSnapshot.ts` — 그리기를 막지 않는 원자적 스냅샷(자동저장용)
- `src/lib/canvas/container.ts` — 컨테이너 pack/unpack, manifest 타입 정의
- `src/lib/canvas/types.ts` — `TILE_SIZE` 등 기본 상수
- `../server/` — 이 스펙을 구현한 참조 서버(Bun + Hono)
