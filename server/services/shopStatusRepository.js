import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { normalizeShopId, normalizeStatus } from '../../shared/shop-status.js';

function enrichRecord(record, catalogEntry) {
  return {
    ...record,
    floor_plan_id: catalogEntry?.floor_plan_id || null,
    floor_plan_name: catalogEntry?.floor_plan_name || null,
    block_id: catalogEntry?.block_id || null,
    block_name: catalogEntry?.block_name || null,
  };
}

class FileShopStatusRepository {
  constructor({ filePath, catalogService }) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.catalogService = catalogService;
    this.records = new Map();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const fileContents = await readFile(this.filePath, 'utf8');
      const rows = JSON.parse(fileContents);

      rows.forEach((row) => {
        if (!row?.shop_id || !row?.status) {
          return;
        }

        this.records.set(normalizeShopId(row.shop_id), {
          shop_id: normalizeShopId(row.shop_id),
          status: normalizeStatus(row.status),
          source_text: row.source_text || null,
          updated_at: row.updated_at || new Date().toISOString(),
        });
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async persist() {
    await writeFile(
      this.filePath,
      JSON.stringify([...this.records.values()], null, 2),
      'utf8',
    );
  }

  async listStatuses({ floorPlanId } = {}) {
    const rows = [...this.records.values()];

    return Promise.all(
      rows
        .filter((row) => row.status)
        .map(async (row) => {
          const catalogEntry = await this.catalogService.getByShopId(row.shop_id);

          if (floorPlanId && catalogEntry?.floor_plan_id !== floorPlanId) {
            return null;
          }

          return enrichRecord(row, catalogEntry);
        }),
    ).then((records) =>
      records
        .filter(Boolean)
        .sort((recordA, recordB) => recordA.shop_id.localeCompare(recordB.shop_id)),
    );
  }

  async upsertStatus({ shop_id, status, source_text = null }) {
    const record = {
      shop_id: normalizeShopId(shop_id),
      status: normalizeStatus(status),
      source_text,
      updated_at: new Date().toISOString(),
    };

    this.records.set(record.shop_id, record);
    await this.persist();

    const catalogEntry = await this.catalogService.getByShopId(record.shop_id);
    return enrichRecord(record, catalogEntry);
  }
}

class SupabaseShopStatusRepository {
  constructor({ supabaseUrl, serviceRoleKey, catalogService }) {
    this.catalogService = catalogService;
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  async init() {}

  async listStatuses({ floorPlanId } = {}) {
    const { data, error } = await this.client
      .from('shop_statuses')
      .select('shop_id, status, source_text, updated_at')
      .order('shop_id', { ascending: true });

    if (error) {
      throw error;
    }

    return Promise.all(
      (data || []).map(async (row) => {
        const catalogEntry = await this.catalogService.getByShopId(row.shop_id);

        if (floorPlanId && catalogEntry?.floor_plan_id !== floorPlanId) {
          return null;
        }

        return enrichRecord(
          {
            shop_id: normalizeShopId(row.shop_id),
            status: normalizeStatus(row.status),
            source_text: row.source_text || null,
            updated_at: row.updated_at || new Date().toISOString(),
          },
          catalogEntry,
        );
      }),
    ).then((records) => records.filter(Boolean));
  }

  async upsertStatus({ shop_id, status, source_text = null }) {
    const payload = {
      shop_id: normalizeShopId(shop_id),
      status: normalizeStatus(status),
      source_text,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.client
      .from('shop_statuses')
      .upsert(payload)
      .select('shop_id, status, source_text, updated_at')
      .single();

    if (error) {
      throw error;
    }

    const catalogEntry = await this.catalogService.getByShopId(payload.shop_id);
    return enrichRecord(data, catalogEntry);
  }
}

export function createShopStatusRepository({
  catalogService,
  storageFile,
  supabaseUrl,
  supabaseServiceRoleKey,
}) {
  if (supabaseUrl && supabaseServiceRoleKey) {
    return new SupabaseShopStatusRepository({
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      catalogService,
    });
  }

  return new FileShopStatusRepository({
    filePath: storageFile,
    catalogService,
  });
}
