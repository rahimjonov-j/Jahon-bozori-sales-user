import { formatStatusLabel } from '../../shared/shop-status.js';

export default function StatusPill({ status }) {
  return (
    <span className={`status-pill status-pill--${status}`}>
      {formatStatusLabel(status)}
    </span>
  );
}
