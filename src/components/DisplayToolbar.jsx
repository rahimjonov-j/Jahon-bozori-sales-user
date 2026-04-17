function formatTime(value) {
  if (!value) {
    return 'Waiting for first sync';
  }

  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function DisplayToolbar({
  displayMode,
  onToggleDisplayMode,
  slideshowEnabled,
  onToggleSlideshow,
  slideshowIntervalMs,
  refreshIntervalMs,
  lastUpdated,
  isRefreshing,
  onRefresh,
  activeSummary,
  detectedShopCount,
  activePlanName,
}) {
  return (
    <section className="toolbar-panel">
      <div className="toolbar-controls">
        <button
          type="button"
          className={`control-button ${displayMode ? 'is-active' : ''}`}
          onClick={onToggleDisplayMode}
        >
          {displayMode ? 'Exit display mode' : 'Display mode'}
        </button>

        <button
          type="button"
          className={`control-button ${slideshowEnabled ? 'is-active' : ''}`}
          onClick={onToggleSlideshow}
        >
          {slideshowEnabled ? 'Stop slideshow' : 'Start slideshow'}
        </button>

        <button
          type="button"
          className="control-button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh now'}
        </button>
      </div>

      <div className="toolbar-metrics">
        <div className="metric-card">
          <span className="metric-card__label">Sold</span>
          <strong>{activeSummary.sold}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Booked</span>
          <strong>{activeSummary.booked}</strong>
        </div>
        <div className="metric-card">
          <span className="metric-card__label">Available</span>
          <strong>{activeSummary.available}</strong>
        </div>
        <div className="metric-card metric-card--wide">
          <span className="metric-card__label">{activePlanName}</span>
          <strong>{detectedShopCount} shop labels detected</strong>
          <span className="metric-card__meta">
            Auto refresh every {Math.round(refreshIntervalMs / 1000)}s. Slideshow
            interval {Math.round(slideshowIntervalMs / 1000)}s.
          </span>
        </div>
        <div className="metric-card metric-card--wide">
          <span className="metric-card__label">Feed heartbeat</span>
          <strong>{formatTime(lastUpdated)}</strong>
          <span className="metric-card__meta">
            {isRefreshing ? 'Sync in progress' : 'Mock service ready for API swap'}
          </span>
        </div>
      </div>
    </section>
  );
}
