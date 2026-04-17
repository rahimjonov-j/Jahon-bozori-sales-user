const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const WS_BASE_URL = (import.meta.env.VITE_WS_BASE_URL || '').replace(/\/$/, '');

function buildUrl(pathname) {
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname;
}

async function request(pathname, options = {}) {
  const response = await fetch(buildUrl(pathname), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json();
      errorMessage = payload.error || errorMessage;
    } catch {
      errorMessage = response.statusText || errorMessage;
    }

    throw new Error(errorMessage);
  }

  return response.json();
}

export const apiClient = {
  getHealth() {
    return request('/api/health');
  },
  getShopStatuses() {
    return request('/api/shop-statuses');
  },
  updateShopStatus(payload) {
    return request('/api/shop-statuses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  ingestSalesText(payload) {
    return request('/api/sales-events/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getWebSocketUrl() {
    if (WS_BASE_URL) {
      return `${WS_BASE_URL}/ws/shop-statuses`;
    }

    const url = API_BASE_URL
      ? new URL(API_BASE_URL, window.location.origin)
      : new URL(window.location.origin);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/shop-statuses';
    url.search = '';
    return url.toString();
  },
};
