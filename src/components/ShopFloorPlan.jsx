import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchSvgMarkup } from '../services/svgAssetService';
import { fetchFloorPlanGeometry } from '../services/floorPlanGeometryService';
import {
  applyShopStatuses,
  initializeShopLayer,
  syncSelectedShop,
} from '../utils/svgShopLayer';

export default function ShopFloorPlan({
  floorPlan,
  statusMap,
  selectedShopId,
  onHoverShopChange,
  onSelectShop,
  onShopIdsChange,
}) {
  const containerRef = useRef(null);
  const registryRef = useRef(new Map());
  const [svgMarkup, setSvgMarkup] = useState('');
  const [shopGeometry, setShopGeometry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadSvg() {
      setIsLoading(true);
      setErrorMessage('');
      setShopGeometry(null);

      try {
        const [markup, geometry] = await Promise.all([
          fetchSvgMarkup(floorPlan.assetPath),
          fetchFloorPlanGeometry(floorPlan.assetPath).catch(() => null),
        ]);

        if (!isMounted) {
          return;
        }

        setSvgMarkup(markup);
        setShopGeometry(geometry);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : 'Unable to load the SVG asset.',
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSvg();

    return () => {
      isMounted = false;
    };
  }, [floorPlan.assetPath]);

  useLayoutEffect(() => {
    if (!svgMarkup || !containerRef.current) {
      return undefined;
    }

    const session = initializeShopLayer({
      container: containerRef.current,
      geometryShops: shopGeometry?.shops || [],
      onHoverShopChange,
      onSelectShop,
    });

    registryRef.current = session.registry;
    onShopIdsChange([...session.registry.keys()]);
    applyShopStatuses(session.registry, statusMap);
    syncSelectedShop(session.registry, selectedShopId);

    return () => {
      registryRef.current = new Map();
      onHoverShopChange(null);
      onShopIdsChange([]);
      session.cleanup();
    };
  }, [
    floorPlan.id,
    shopGeometry,
    onHoverShopChange,
    onSelectShop,
    onShopIdsChange,
    svgMarkup,
  ]);

  useEffect(() => {
    applyShopStatuses(registryRef.current, statusMap);
  }, [statusMap]);

  useEffect(() => {
    syncSelectedShop(registryRef.current, selectedShopId);
  }, [selectedShopId]);

  if (isLoading) {
    return (
      <div className="plan-stage">
        <p className="plan-message">Loading floor plan...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="plan-stage">
        <div className="plan-message plan-message--error">
          <strong>SVG unavailable</strong>
          <span>{errorMessage}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="plan-stage">
      <div
        ref={containerRef}
        className="plan-canvas"
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
      />
    </div>
  );
}
