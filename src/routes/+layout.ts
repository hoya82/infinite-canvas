// 브라우저 전용 SPA이므로 정적 셸로 프리렌더링한 뒤 클라이언트에서 하이드레이션한다.
// (서버 라우트 없음, adapter-static 요구사항)
export const prerender = true;
