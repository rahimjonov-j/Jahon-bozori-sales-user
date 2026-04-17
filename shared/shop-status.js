export const SHOP_ID_PATTERN = /^[A-Z]-\d+-\d+$/;
export const SHOP_STATUSES = ['available', 'reserved', 'sold'];

export const SHOP_STATUS_META = {
  available: {
    label: 'Available',
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
  },
  reserved: {
    label: 'Reserved',
    fill: 'rgba(245, 198, 59, 0.34)',
    stroke: '#d6a20a',
    strokeWidth: 2.4,
  },
  sold: {
    label: 'Sold',
    fill: 'rgba(214, 38, 59, 0.28)',
    stroke: '#d4263b',
    strokeWidth: 2.6,
  },
};

export function normalizeShopId(value = '') {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

export function isValidShopId(value = '') {
  return SHOP_ID_PATTERN.test(normalizeShopId(value));
}

export function normalizeStatus(value = '') {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'bron' || normalized === 'booked') {
    return 'reserved';
  }

  if (SHOP_STATUSES.includes(normalized)) {
    return normalized;
  }

  return '';
}

export function isValidStatus(value = '') {
  return SHOP_STATUSES.includes(normalizeStatus(value));
}

export function parseShopId(shopId) {
  const normalizedShopId = normalizeShopId(shopId);
  const [blockId, section, unitNumber] = normalizedShopId.split('-');

  return {
    shop_id: normalizedShopId,
    block_id: blockId || '',
    section: section || '',
    unit_number: unitNumber || '',
  };
}

export function formatStatusLabel(status) {
  const normalizedStatus = normalizeStatus(status);

  if (!normalizedStatus) {
    return 'Unknown';
  }

  return SHOP_STATUS_META[normalizedStatus]?.label || normalizedStatus;
}
