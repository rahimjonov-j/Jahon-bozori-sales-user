import { useState } from 'react';
import {
  SHOP_STATUSES,
  formatStatusLabel,
  parseShopId,
} from '../../shared/shop-status.js';
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

export default function ShopStatusModal({
  shopId,
  record,
  floorPlanName,
  onClose,
  onStatusChange,
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!shopId) {
    return null;
  }

  const metadata = parseShopId(shopId);
  const activeStatus = record?.status || 'available';

  async function handleStatusClick(status) {
    setIsSaving(true);
    setErrorMessage('');

    try {
      await onStatusChange(status);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update the shop.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-heading">
          <p className="panel-heading__eyebrow">Selected shop</p>
          <h2 id="shop-modal-title" className="panel-heading__title">
            {shopId}
          </h2>
        </div>

        <div className="shop-status-line">
          <StatusPill status={activeStatus} />
          <span>{formatStatusLabel(activeStatus)}</span>
        </div>

        <div className="detail-list">
          <div className="detail-row">
            <span>Block</span>
            <strong>{metadata.block_id}</strong>
          </div>
          <div className="detail-row">
            <span>Section</span>
            <strong>{metadata.section}</strong>
          </div>
          <div className="detail-row">
            <span>Unit</span>
            <strong>{metadata.unit_number}</strong>
          </div>
          <div className="detail-row">
            <span>SVG view</span>
            <strong>{record?.floor_plan_name || floorPlanName}</strong>
          </div>
          <div className="detail-row">
            <span>Updated</span>
            <strong>{formatTimestamp(record?.updated_at)}</strong>
          </div>
        </div>

        <div className="status-action-grid">
          {SHOP_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`status-action ${
                activeStatus === status ? 'is-active' : ''
              }`}
              onClick={() => handleStatusClick(status)}
              disabled={isSaving}
            >
              {formatStatusLabel(status)}
            </button>
          ))}
        </div>

        {record?.source_text ? (
          <div className="source-note">
            <span>Last source text</span>
            <p>{record.source_text}</p>
          </div>
        ) : null}

        {errorMessage ? <p className="panel-alert">{errorMessage}</p> : null}

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
