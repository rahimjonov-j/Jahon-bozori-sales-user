import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../services/apiClient';
import { mockShopStatusService } from '../services/mockShopStatusService';

function indexStatuses(records) {
  return records.reduce((statusMap, record) => {
    statusMap[record.shop_id] = record;
    return statusMap;
  }, {});
}

export function useShopStatusFeed() {
  const [statusMap, setStatusMap] = useState({});
  const [connectionState, setConnectionState] = useState('connecting');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [systemInfo, setSystemInfo] = useState(null);
  const activeTransportRef = useRef('mock');

  async function loadSnapshot({ silent = false, transport } = {}) {
    if (!silent) {
      setIsLoading(true);
    }

    const preferredTransport = transport || activeTransportRef.current;

    try {
      const [statuses, info] =
        preferredTransport === 'api'
          ? await Promise.all([apiClient.getShopStatuses(), apiClient.getHealth()])
          : await Promise.all([
              mockShopStatusService.getShopStatuses(),
              mockShopStatusService.getSystemInfo(),
            ]);

      setStatusMap(indexStatuses(statuses));
      setSystemInfo(info);
      setConnectionState(preferredTransport === 'api' ? 'live' : 'mock');
      setLastSyncAt(new Date().toISOString());
      setErrorMessage('');
      activeTransportRef.current = preferredTransport;
    } catch (error) {
      if (preferredTransport === 'api') {
        activeTransportRef.current = 'mock';
        return loadSnapshot({ silent, transport: 'mock' });
      }

      setErrorMessage(
        error instanceof Error ? error.message : "Status snapshot yuklanmadi.",
      );
      setConnectionState('offline');
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }

  function applyRecord(record) {
    if (!record?.shop_id) {
      return;
    }

    setStatusMap((currentStatusMap) => ({
      ...currentStatusMap,
      [record.shop_id]: record,
    }));
    setLastSyncAt(record.updated_at || new Date().toISOString());
  }

  useEffect(() => {
    let isActive = true;
    let websocket = null;
    let unsubscribeMock = () => {};

    const attachMockSubscription = () => {
      unsubscribeMock = mockShopStatusService.subscribe(() => {
        if (isActive && activeTransportRef.current === 'mock') {
          loadSnapshot({ silent: true, transport: 'mock' });
        }
      });
    };

    const attachRealtimeFeed = () => {
      websocket = new WebSocket(apiClient.getWebSocketUrl());

      websocket.addEventListener('open', () => {
        if (!isActive) {
          return;
        }

        setConnectionState('live');
        setErrorMessage('');
      });

      websocket.addEventListener('message', (event) => {
        if (!isActive) {
          return;
        }

        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'snapshot' && Array.isArray(payload.data)) {
            setStatusMap(indexStatuses(payload.data));
            setLastSyncAt(new Date().toISOString());
            return;
          }

          if (payload.type === 'status-updated' && payload.data) {
            applyRecord(payload.data);
          }
        } catch {
          setConnectionState('polling');
        }
      });

      websocket.addEventListener('close', () => {
        if (!isActive || activeTransportRef.current !== 'api') {
          return;
        }

        setConnectionState('polling');
      });

      websocket.addEventListener('error', () => {
        if (!isActive || activeTransportRef.current !== 'api') {
          return;
        }

        setConnectionState('polling');
      });
    };

    const initializeFeed = async () => {
      try {
        await loadSnapshot({ transport: 'api' });

        if (!isActive || activeTransportRef.current !== 'api') {
          attachMockSubscription();
          return;
        }

        attachRealtimeFeed();
      } catch {
        attachMockSubscription();
      }
    };

    initializeFeed();

    return () => {
      isActive = false;
      unsubscribeMock();
      websocket?.close();
    };
  }, []);

  const statuses = useMemo(
    () =>
      Object.values(statusMap).sort((recordA, recordB) =>
        recordA.shop_id.localeCompare(recordB.shop_id),
      ),
    [statusMap],
  );

  return {
    statusMap,
    statuses,
    connectionState,
    lastSyncAt,
    errorMessage,
    isLoading,
    systemInfo,
    refreshStatuses: () => loadSnapshot({ silent: true }),
    async updateShopStatus(payload) {
      const record =
        activeTransportRef.current === 'api'
          ? await apiClient.updateShopStatus(payload)
          : await mockShopStatusService.updateShopStatus(payload);
      applyRecord(record);
      return record;
    },
    async ingestSalesText(rawText) {
      const result =
        activeTransportRef.current === 'api'
          ? await apiClient.ingestSalesText({ raw_text: rawText })
          : await mockShopStatusService.ingestSalesText(rawText);

      if (result?.record) {
        applyRecord(result.record);
      }

      return result;
    },
  };
}
