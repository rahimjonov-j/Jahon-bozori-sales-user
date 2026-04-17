import {
  isValidShopId,
  isValidStatus,
  normalizeShopId,
  normalizeStatus,
  parseShopId,
} from '../../shared/shop-status.js';
import { floorPlans } from '../../shared/floor-plans.js';
import seedStatuses from '../mocks/shopStatusSeed';
import { getShopCatalog, getShopCatalogEntry } from './shopCatalogClient';

const STORAGE_KEY = 'hengtai-shop-statuses-v1';
const CHANNEL_NAME = 'hengtai-shop-status-events';
const listeners = new Set();
const canUseWindow = typeof window !== 'undefined';
const broadcastChannel =
  canUseWindow && 'BroadcastChannel' in window
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

if (broadcastChannel) {
  broadcastChannel.addEventListener('message', (event) => {
    if (event.data?.type === 'shop-status-sync') {
      emitChange();
    }
  });
}

if (canUseWindow) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      emitChange();
    }
  });
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function notifyAllTabs() {
  broadcastChannel?.postMessage({
    type: 'shop-status-sync',
  });
}

function readStoredRecords() {
  if (!canUseWindow) {
    return [];
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredRecords(records) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  emitChange();
  notifyAllTabs();
}

function ensureSeedData() {
  if (!canUseWindow) {
    return;
  }

  const existing = readStoredRecords();
  const existingByShopId = new Map(
    existing.map((record) => [normalizeShopId(record.shop_id), record]),
  );
  let hasChanges = existing.length === 0;

  seedStatuses.forEach((record) => {
    const normalizedShopId = normalizeShopId(record.shop_id);

    if (existingByShopId.has(normalizedShopId)) {
      return;
    }

    existingByShopId.set(normalizedShopId, {
      ...record,
      shop_id: normalizedShopId,
      updated_at: new Date().toISOString(),
    });
    hasChanges = true;
  });

  if (!hasChanges) {
    return;
  }

  writeStoredRecords(
    [...existingByShopId.values()].sort((recordA, recordB) =>
      recordA.shop_id.localeCompare(recordB.shop_id),
    ),
  );
}

function inferStatusFromText(rawText) {
  const normalized = rawText.toLowerCase();

  if (normalized.includes('bron')) {
    return 'reserved';
  }

  if (normalized.includes('sotildi') || normalized.includes('sotuv')) {
    return 'sold';
  }

  throw new Error('Status aniqlanmadi. "sotildi" yoki "bron" qatnashishi kerak.');
}

function inferShopIdFromText(rawText) {
  const compactMatch = rawText.match(/([A-Za-z])\s*-\s*(\d+)\s*-\s*(\d+)/);

  if (compactMatch) {
    return `${compactMatch[1].toUpperCase()}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  const semanticMatch = rawText.match(
    /([A-Za-z])(?:\s*blok)?\s+(\d+)(?:\s*qavat)?\s+(\d+)/i,
  );

  if (semanticMatch) {
    return `${semanticMatch[1].toUpperCase()}-${semanticMatch[2]}-${semanticMatch[3]}`;
  }

  throw new Error('shop_id aniqlanmadi. Masalan: A-5-112 yoki A blok 5 qavat 112');
}

async function enrichRecord(record) {
  const catalogEntry = await getShopCatalogEntry(record.shop_id);

  return {
    ...parseShopId(record.shop_id),
    ...record,
    floor_plan_id: catalogEntry?.floor_plan_id || null,
    floor_plan_name: catalogEntry?.floor_plan_name || null,
    block_id: catalogEntry?.block_id || parseShopId(record.shop_id).block_id,
    block_name: catalogEntry?.block_name || `${parseShopId(record.shop_id).block_id} Block`,
  };
}

export const mockShopStatusService = {
  async getSystemInfo() {
    const catalog = await getShopCatalog();

    return {
      ok: true,
      storage: 'localStorage',
      parser: 'mock-parser',
      realtime: broadcastChannel ? 'broadcast-channel' : 'same-tab',
      shop_count: catalog.items.length,
      floor_plan_count: floorPlans.length,
    };
  },

  async getShopStatuses() {
    ensureSeedData();

    const records = readStoredRecords().filter(
      (record) => isValidShopId(record.shop_id) && isValidStatus(record.status),
    );
    const enriched = await Promise.all(
      records.map((record) =>
        enrichRecord({
          ...record,
          shop_id: normalizeShopId(record.shop_id),
          status: normalizeStatus(record.status),
        }),
      ),
    );

    return enriched.sort((recordA, recordB) =>
      recordA.shop_id.localeCompare(recordB.shop_id),
    );
  },

  async updateShopStatus({ shop_id, status, source_text = null }) {
    ensureSeedData();
    const normalizedShopId = normalizeShopId(shop_id);
    const normalizedStatus = normalizeStatus(status);

    if (!isValidShopId(normalizedShopId)) {
      throw new Error(`Noto'g'ri shop_id: ${shop_id}`);
    }

    if (!isValidStatus(normalizedStatus)) {
      throw new Error(`Noto'g'ri status: ${status}`);
    }

    const nextRecord = {
      shop_id: normalizedShopId,
      status: normalizedStatus,
      source_text,
      updated_at: new Date().toISOString(),
    };
    const records = readStoredRecords().filter(
      (record) => normalizeShopId(record.shop_id) !== normalizedShopId,
    );

    records.push(nextRecord);
    writeStoredRecords(records);

    return enrichRecord(nextRecord);
  },

  async parseSalesText(rawText) {
    const shop_id = inferShopIdFromText(rawText);
    const status = inferStatusFromText(rawText);
    const catalogEntry = await getShopCatalogEntry(shop_id);

    if (!catalogEntry) {
      throw new Error(`SVG ichida topilmadi: ${shop_id}`);
    }

    return {
      shop_id,
      status,
    };
  },

  async ingestSalesText(rawText) {
    const parsed = await this.parseSalesText(rawText);
    const record = await this.updateShopStatus({
      ...parsed,
      source_text: rawText,
    });

    return {
      parsed,
      record,
    };
  },

  subscribe(listener) {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
};
