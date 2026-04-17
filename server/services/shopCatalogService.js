import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { floorPlans } from '../../shared/floor-plans.js';
import { isValidShopId, normalizeShopId, parseShopId } from '../../shared/shop-status.js';

const SHOP_ID_MATCHER = /[A-Z]-\d+-\d+/g;

function unique(values) {
  return [...new Set(values)];
}

function extractShopIds(svgMarkup) {
  return unique(
    Array.from(svgMarkup.matchAll(SHOP_ID_MATCHER), (match) =>
      normalizeShopId(match[0]),
    ).filter((shopId) => isValidShopId(shopId)),
  );
}

export function createShopCatalogService() {
  let catalogPromise = null;

  async function loadCatalog() {
    const floorPlanEntries = await Promise.all(
      floorPlans.map(async (floorPlan) => {
        const filePath = path.resolve(process.cwd(), floorPlan.assetFile);
        const svgMarkup = await readFile(filePath, 'utf8');

        return extractShopIds(svgMarkup).map((shopId) => ({
          shop_id: shopId,
          floor_plan_id: floorPlan.id,
          floor_plan_name: floorPlan.name,
          block_id: floorPlan.blockId,
          block_name: floorPlan.blockName,
          asset_path: floorPlan.assetPath,
          ...parseShopId(shopId),
        }));
      }),
    );

    const items = floorPlanEntries.flat();
    const map = new Map(items.map((item) => [item.shop_id, item]));
    const byFloorPlan = new Map();

    items.forEach((item) => {
      if (!byFloorPlan.has(item.floor_plan_id)) {
        byFloorPlan.set(item.floor_plan_id, []);
      }

      byFloorPlan.get(item.floor_plan_id).push(item);
    });

    return {
      items,
      map,
      byFloorPlan,
    };
  }

  async function getCatalog() {
    if (!catalogPromise) {
      catalogPromise = loadCatalog();
    }

    return catalogPromise;
  }

  return {
    async listAll() {
      return (await getCatalog()).items;
    },
    async listByFloorPlan(floorPlanId) {
      return (await getCatalog()).byFloorPlan.get(floorPlanId) || [];
    },
    async getByShopId(shopId) {
      return (await getCatalog()).map.get(normalizeShopId(shopId)) || null;
    },
    async hasShopId(shopId) {
      return Boolean(await this.getByShopId(shopId));
    },
  };
}
