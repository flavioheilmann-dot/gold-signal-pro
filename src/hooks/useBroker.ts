import { useCallback, useEffect, useState } from "react";
import {
  getStatus,
  getAccount,
  getPositions,
  type BrokerStatus,
  type BrokerAccount,
  type BrokerPosition,
} from "@/lib/capital";

export function useBroker(intervalMs = 20000) {
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [account, setAccount] = useState<BrokerAccount | null>(null);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);

  const refresh = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    if (s.connected) {
      try {
        setAccount(await getAccount());
      } catch {
        setAccount(null);
      }
      try {
        setPositions((await getPositions()).positions);
      } catch {
        setPositions([]);
      }
    } else {
      setAccount(null);
      setPositions([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { status, account, positions, refresh };
}
