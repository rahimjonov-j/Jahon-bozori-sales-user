import { useEffect } from 'react';

export function useSlideshow({
  enabled,
  itemIds,
  activeId,
  intervalMs,
  onAdvance,
}) {
  useEffect(() => {
    if (!enabled || itemIds.length < 2) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      const activeIndex = itemIds.indexOf(activeId);
      const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % itemIds.length : 0;
      onAdvance(itemIds[nextIndex]);
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeId, enabled, intervalMs, itemIds, onAdvance]);
}
