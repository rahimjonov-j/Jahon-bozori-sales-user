import { floorPlans } from '../shared/floor-plans.js';
import ShopFloorPlan from './components/ShopFloorPlan';
import { useShopStatusFeed } from './hooks/useShopStatusFeed';

const noop = () => {};

export default function App() {
  const activeFloorPlan = floorPlans[0];
  const { statusMap } = useShopStatusFeed();

  return (
    <div className="app-shell app-shell--bare">
      <ShopFloorPlan
        floorPlan={activeFloorPlan}
        statusMap={statusMap}
        selectedShopId={null}
        onHoverShopChange={noop}
        onSelectShop={noop}
        onShopIdsChange={noop}
      />
    </div>
  );
}
