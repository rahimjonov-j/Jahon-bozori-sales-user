import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchSvgMarkup } from '../services/svgAssetService';
import { decorateSvgFloorplan } from '../utils/svgFloorplanParser';

export default function FloorPlanCanvas({
  activeBlock,
  activeFloorPlan,
  shopStatusMap,
  pureDisplay,
  onShopSelect,
  onDetectedShopCountChange,
}) {
  const containerRef = useRef(null);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadSvg = async () => {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const markup = await fetchSvgMarkup(activeFloorPlan.svgPath);

        if (!isMounted) {
          return;
        }

        setSvgMarkup(markup);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : 'SVG asset could not be loaded.',
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadSvg();

    return () => {
      isMounted = false;
    };
  }, [activeFloorPlan.svgPath]);

  useLayoutEffect(() => {
    if (!svgMarkup || !containerRef.current) {
      return undefined;
    }

    const decoration = decorateSvgFloorplan({
      container: containerRef.current,
      activeBlock,
      activeFloorPlan,
      shopStatusMap,
      onShopSelect,
    });
    onDetectedShopCountChange(decoration.detectedShops.length);

    return () => {
      onDetectedShopCountChange(0);
      decoration.cleanup();
    };
  }, [
    activeBlock,
    activeFloorPlan,
    onDetectedShopCountChange,
    onShopSelect,
    shopStatusMap,
    svgMarkup,
  ]);

  if (isLoading) {
    return (
      <section className={`plan-stage ${pureDisplay ? 'plan-stage--pure' : ''}`}>
        <div className="plan-message">Loading floor plan...</div>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className={`plan-stage ${pureDisplay ? 'plan-stage--pure' : ''}`}>
        <div className="plan-message plan-message--error">
          <strong>SVG asset missing</strong>
          <span>{errorMessage}</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`plan-stage ${pureDisplay ? 'plan-stage--pure' : ''}`}>
      <div className="plan-canvas-wrap">
        <div
          ref={containerRef}
          className="plan-canvas"
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      </div>
    </section>
  );
}
