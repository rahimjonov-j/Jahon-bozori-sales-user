export const floorPlans = [
  {
    id: 'A-1',
    blockId: 'A',
    blockName: 'A Block',
    name: '1-etaj',
    assetPath: '/assets/Ablock-1-etaj.svg',
    assetFile: 'public/assets/Ablock-1-etaj.svg',
  },
  {
    id: 'A-2',
    blockId: 'A',
    blockName: 'A Block',
    name: '2-etaj',
    assetPath: '/assets/Ablock-2-etaj.svg',
    assetFile: 'public/assets/Ablock-2-etaj.svg',
  },
];

export function getFloorPlanById(floorPlanId) {
  return floorPlans.find((floorPlan) => floorPlan.id === floorPlanId) || null;
}
