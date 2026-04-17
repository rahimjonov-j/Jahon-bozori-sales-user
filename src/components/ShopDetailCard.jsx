import { formatStatusLabel, parseShopId } from '../../shared/shop-status.js';
import StatusPill from './StatusPill';

function formatTimestamp(value) {
  if (!value) {
    return 'Not updated yet';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ShopDetailCard({ shopId, record, floorPlanName }) {
  if (!shopId) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <p className="panel-heading__eyebrow">Shop details</p>
          <h2 className="panel-heading__title">Hover or click a shop</h2>
        </div>

        <p className="panel-note">
          Hover reveals shop information instantly. Click a shop to open the
          detail modal and change its status manually.
        </p>
      </section>
    );
  }

  const metadata = parseShopId(shopId);
  const status = record?.status || 'available';

  return (
    <section className="panel panel--accent">
      <div className="panel-heading">
        <p className="panel-heading__eyebrow">Shop details</p>
        <h2 className="panel-heading__title">{shopId}</h2>
      </div>

      <div className="shop-status-line">
        <StatusPill status={status} />
        <span>{formatStatusLabel(status)}</span>
      </div>

      <div className="detail-list">
        <DetailRow label="Block" value={metadata.block_id || 'Unknown'} />
        <DetailRow label="Section" value={metadata.section || 'Unknown'} />
        <DetailRow label="Unit" value={metadata.unit_number || 'Unknown'} />
        <DetailRow label="SVG view" value={record?.floor_plan_name || floorPlanName} />
        <DetailRow label="Updated" value={formatTimestamp(record?.updated_at)} />
      </div>

      {record?.source_text ? (
        <div className="source-note">
          <span>Last source text</span>
          <p>{record.source_text}</p>
        </div>
      ) : null}
    </section>
  );
}
