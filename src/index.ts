import { Hono } from 'hono';
import { api } from './api';

const app = new Hono<{ Bindings: Env }>();

app.route('/api', api);

// Anything that isn't an API route is the Preact app shell. Static assets that
// exist on disk are served before the Worker ever runs; this catch-all only
// sees client-side routes, and `not_found_handling: single-page-application`
// turns them into index.html.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
