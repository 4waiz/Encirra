/**
 * Cloudflare Worker for the hosted Encirra demo (encirra.kanbanstudios.ae).
 *
 * The site is the static production build (served by Workers static assets). The Python
 * simulation service is not deployed, so /api/health reports it offline and the app runs on the
 * bundled replay of precomputed solver output — labelled as a replay in the UI.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health') {
      return Response.json(
        { ok: false, reason: 'Hosted demo: the simulation service is not deployed; the app uses the bundled replay of precomputed solver output.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: 'The simulation service is not available in the hosted demo.' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
};
