import { floorPlans } from '../../shared/floor-plans.js';
import { parseShopId } from '../../shared/shop-status.js';
import { fetchSvgMarkup } from './svgAssetService';

const SHOP_ID_MATCHER = /[A-Z]-\d+-\d+/g;
let catalogPromise = null;

function unique(values) {
  return [...new Set(values)];
}

async function loadCatalog() {
  const itemsByFloor = await Promise.all(
    floorPlans.map(async (floorPlan) => {
      const svgMarkup = await fetchSvgMarkup(floorPlan.assetPath);
      const shopIds = unique(
        Array.from(svgMarkup.matchAll(SHOP_ID_MATCHER), (match) => match[0]),
      );

      return shopIds.map((shopId) => ({
        shop_id: shopId,
        floor_plan_id: floorPlan.id,
        floor_plan_name: floorPlan.name,
        block_id: floorPlan.blockId,
        block_name: floorPlan.blockName,
        ...parseShopId(shopId),
      }));
    }),
  );

  const items = itemsByFloor.flat();
  const byShopId = new Map(items.map((item) => [item.shop_id, item]));

  return {
    items,
    byShopId,
  };
}

export async function getShopCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadCatalog();
  }

  return catalogPromise;
}

export async function getShopCatalogEntry(shopId) {
  return (await getShopCatalog()).byShopId.get(shopId) || null;
}
