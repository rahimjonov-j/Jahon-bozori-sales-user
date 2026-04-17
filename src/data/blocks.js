const blocks = [
  {
    id: 'A',
    name: 'A block',
    description: 'A blockning real 1- va 2-etaj planlari.',
    floorPlans: [
      {
        id: 'A-1',
        name: '1-etaj',
        svgPath: '/assets/Ablock-1-etaj.svg',
      },
      {
        id: 'A-2',
        name: '2-etaj',
        svgPath: '/assets/Ablock-2-etaj.svg',
      },
    ],
  },
];

export function getAllFloorPlans() {
  return blocks.flatMap((block) =>
    block.floorPlans.map((floorPlan) => ({
      ...floorPlan,
      blockId: block.id,
      blockName: block.name,
    })),
  );
}

export default blocks;
