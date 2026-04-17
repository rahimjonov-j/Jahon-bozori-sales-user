import StatusPill from './StatusPill';
import { formatStatus } from '../utils/shopLabel';

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ShopInfoPanel({ shop }) {
  if (!shop) {
    return (
      <section className="info-panel">
        <div className="panel-heading">
          <p className="panel-heading__eyebrow">Shop details</p>
          <h2 className="panel-heading__title">Interactive unit inspector</h2>
        </div>

        <p className="empty-copy">
          Select any detected shop label inside the floor plan to inspect its
          status, block, floor, and unit number.
        </p>
      </section>
    );
  }

  return (
    <section className="info-panel info-panel--accent">
      <div className="panel-heading">
        <p className="panel-heading__eyebrow">Selected shop</p>
        <h2 className="panel-heading__title">{shop.label}</h2>
      </div>

      <div className="shop-status-line">
        <StatusPill status={shop.status} />
        <span>{formatStatus(shop.status)} status</span>
      </div>

      <div className="detail-list">
        <DetailRow label="Block" value={shop.blockName} />
        <DetailRow label="Plan" value={shop.planName || 'Unknown'} />
        <DetailRow label="Floor" value={shop.floor || 'Unknown'} />
        <DetailRow label="Unit" value={shop.unitNumber || 'Unknown'} />
      </div>
    </section>
  );
}
