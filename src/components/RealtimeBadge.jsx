function formatSyncTime(value) {
  if (!value) {
    return 'Waiting for snapshot';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export default function RealtimeBadge({ connectionState, lastSyncAt }) {
  return (
    <div className={`realtime-badge realtime-badge--${connectionState}`}>
      <strong>{connectionState}</strong>
      <span>Last sync {formatSyncTime(lastSyncAt)}</span>
    </div>
  );
}
