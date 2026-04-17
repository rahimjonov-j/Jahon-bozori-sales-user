export const SHOP_LABEL_PATTERN = /^[A-Z]-\d+-\d+$/;

export function normalizeShopLabel(value = '') {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

export function isShopLabel(value = '') {
  return SHOP_LABEL_PATTERN.test(normalizeShopLabel(value));
}

export function inferShopMeta(label) {
  const normalizedLabel = normalizeShopLabel(label);
  const [blockId, floor, unitNumber] = normalizedLabel.split('-');

  return {
    label: normalizedLabel,
    blockId,
    floor: floor ? Number(floor) : null,
    unitNumber: unitNumber || null,
  };
}

export function formatStatus(status) {
  if (!status) {
    return 'Unknown';
  }

  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
