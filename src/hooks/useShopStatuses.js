import { useEffect, useMemo, useState } from 'react';
import { fetchShopStatuses } from '../services/shopStatusService';

export function useShopStatuses({ refreshIntervalMs, floorPlans }) {
  const [shops, setShops] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadShops() {
    setIsRefreshing(true);

    try {
      const snapshot = await fetchShopStatuses({ floorPlans });
      setShops(snapshot.shops);
      setLastUpdated(snapshot.fetchedAt);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    const safeLoad = async () => {
      setIsRefreshing(true);

      try {
        const snapshot = await fetchShopStatuses({ floorPlans });

        if (!isMounted) {
          return;
        }

        setShops(snapshot.shops);
        setLastUpdated(snapshot.fetchedAt);
      } finally {
        if (isMounted) {
          setIsRefreshing(false);
        }
      }
    };

    safeLoad();

    const intervalId = window.setInterval(safeLoad, refreshIntervalMs);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [floorPlans, refreshIntervalMs]);

  const shopStatusMap = useMemo(
    () =>
      shops.reduce((statusMap, shop) => {
        statusMap[`${shop.planId}:${shop.label}`] = shop;
        return statusMap;
      }, {}),
    [shops],
  );

  return {
    shops,
    shopStatusMap,
    lastUpdated,
    isRefreshing,
    refreshNow: loadShops,
  };
}
