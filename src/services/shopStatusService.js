import shopStatuses from '../mocks/shopStatuses';
import { fetchSvgMarkup } from './svgAssetService';
import { extractShopLabelsFromSvg } from '../utils/svgLabelExtractor';
import { inferShopMeta } from '../utils/shopLabel';

let shopCatalogPromise = null;

async function buildShopCatalog(floorPlans) {
  const planCatalog = await Promise.all(
    floorPlans.map(async (floorPlan) => {
      const svgMarkup = await fetchSvgMarkup(floorPlan.svgPath);
      const labels = extractShopLabelsFromSvg(svgMarkup);

      return labels.map((label) => ({
        ...inferShopMeta(label),
        label,
        planId: floorPlan.id,
        planName: floorPlan.name,
        svgPath: floorPlan.svgPath,
      }));
    }),
  );

  return planCatalog.flat();
}

async function getShopCatalog(floorPlans) {
  if (!shopCatalogPromise) {
    shopCatalogPromise = buildShopCatalog(floorPlans);
  }

  return shopCatalogPromise;
}

export async function fetchShopStatuses({ floorPlans }) {
  const shopCatalog = await getShopCatalog(floorPlans);

  await new Promise((resolve) => {
    window.setTimeout(resolve, 80);
  });

  const fetchedAt = new Date().toISOString();

  const shops = shopStatuses
    .map((request) => {
      const catalogEntry = shopCatalog.find(
        (shop) => shop.planId === request.planId && shop.label === request.label,
      );

      if (!catalogEntry) {
        return null;
      }

      return {
        ...catalogEntry,
        ...request,
        status: request.status,
        updatedAt: fetchedAt,
      };
    })
    .filter(Boolean);

  return {
    shops,
    fetchedAt,
  };
}
