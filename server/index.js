import http from 'node:http';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { env } from './config/env.js';
import { floorPlans } from '../shared/floor-plans.js';
import {
  isValidShopId,
  isValidStatus,
  normalizeShopId,
  normalizeStatus,
} from '../shared/shop-status.js';
import { createShopCatalogService } from './services/shopCatalogService.js';
import { createShopStatusRepository } from './services/shopStatusRepository.js';
import { createOpenAiSalesParser } from './services/openAiSalesParser.js';

const statusMutationSchema = z.object({
  shop_id: z.string().min(1),
  status: z.enum(['available', 'reserved', 'sold']),
  source_text: z.string().trim().min(1).optional(),
});

const salesTextSchema = z.object({
  raw_text: z.string().trim().min(1),
});

const app = express();
const server = http.createServer(app);
const websocketServer = new WebSocketServer({
  server,
  path: '/ws/shop-statuses',
});

const catalogService = createShopCatalogService();
const repository = createShopStatusRepository({
  catalogService,
  storageFile: env.SHOP_STATUS_STORAGE_FILE,
  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
});
const salesParser = createOpenAiSalesParser({
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  catalogService,
});

await repository.init();

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
  }),
);
app.use(express.json({ limit: '1mb' }));

function broadcast(message) {
  const payload = JSON.stringify(message);

  websocketServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function ensureKnownShop(shopId) {
  return catalogService.getByShopId(shopId);
}

async function saveStatus({ shop_id, status, source_text = null }) {
  const normalizedShopId = normalizeShopId(shop_id);
  const normalizedStatus = normalizeStatus(status);

  if (!isValidShopId(normalizedShopId)) {
    const error = new Error(`Invalid shop_id "${shop_id}".`);
    error.statusCode = 400;
    throw error;
  }

  if (!isValidStatus(normalizedStatus)) {
    const error = new Error(`Invalid status "${status}".`);
    error.statusCode = 400;
    throw error;
  }

  const knownShop = await ensureKnownShop(normalizedShopId);

  if (!knownShop) {
    const error = new Error(`Shop "${normalizedShopId}" was not found in the SVG catalog.`);
    error.statusCode = 404;
    throw error;
  }

  const record = await repository.upsertStatus({
    shop_id: normalizedShopId,
    status: normalizedStatus,
    source_text,
  });

  broadcast({
    type: 'status-updated',
    data: record,
  });

  return record;
}

websocketServer.on('connection', async (socket) => {
  const snapshot = await repository.listStatuses();

  socket.send(
    JSON.stringify({
      type: 'snapshot',
      data: snapshot,
    }),
  );
});

app.get('/api/health', async (_request, response) => {
  const catalog = await catalogService.listAll();

  response.json({
    ok: true,
    realtime: 'websocket',
    storage: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'file',
    parser: salesParser.isEnabled() ? 'openai' : 'disabled',
    shop_count: catalog.length,
    floor_plan_count: floorPlans.length,
  });
});

app.get('/api/floor-plans', async (_request, response) => {
  const payload = await Promise.all(
    floorPlans.map(async (floorPlan) => {
      const catalog = await catalogService.listByFloorPlan(floorPlan.id);

      return {
        ...floorPlan,
        shop_count: catalog.length,
      };
    }),
  );

  response.json(payload);
});

app.get('/api/shop-catalog', async (request, response) => {
  const floorPlanId = request.query.floorPlanId?.toString() || null;
  const catalog = floorPlanId
    ? await catalogService.listByFloorPlan(floorPlanId)
    : await catalogService.listAll();

  response.json(catalog);
});

app.get('/api/shop-statuses', async (request, response) => {
  const floorPlanId = request.query.floorPlanId?.toString() || undefined;
  const statuses = await repository.listStatuses({ floorPlanId });

  response.json(statuses);
});

app.post('/api/shop-statuses', async (request, response) => {
  const payload = statusMutationSchema.parse(request.body);
  const record = await saveStatus(payload);

  response.status(201).json(record);
});

app.post('/api/parse-sales-text', async (request, response) => {
  const { raw_text } = salesTextSchema.parse(request.body);
  const parsed = await salesParser.parse(raw_text);

  response.json(parsed);
});

app.post('/api/sales-events/ingest', async (request, response) => {
  const { raw_text } = salesTextSchema.parse(request.body);
  const parsed = await salesParser.parse(raw_text);
  const record = await saveStatus({
    ...parsed,
    source_text: raw_text,
  });

  response.status(201).json({
    parsed,
    record,
  });
});

if (env.NODE_ENV === 'production') {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath));

  app.get('*', (request, response, next) => {
    if (request.path.startsWith('/api') || request.path.startsWith('/ws')) {
      next();
      return;
    }

    response.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || (error.name === 'ZodError' ? 400 : 500);

  response.status(statusCode).json({
    error: statusCode === 500 ? 'Internal Server Error' : error.message,
  });
});

server.listen(env.PORT, () => {
  console.log(`Shop status server listening on http://localhost:${env.PORT}`);
});
