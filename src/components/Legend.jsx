import StatusPill from './StatusPill';

export default function Legend() {
  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="panel-heading__eyebrow">Legend</p>
        <h2 className="panel-heading__title">Shop status colors</h2>
      </div>

      <div className="legend-list">
        <div className="legend-item">
          <StatusPill status="sold" />
          <p>Red stroke with semi-transparent fill</p>
        </div>
        <div className="legend-item">
          <StatusPill status="reserved" />
          <p>Yellow stroke with semi-transparent fill</p>
        </div>
        <div className="legend-item">
          <StatusPill status="available" />
          <p>No fill so the original SVG stays readable</p>
        </div>
      </div>
    </section>
  );
}
