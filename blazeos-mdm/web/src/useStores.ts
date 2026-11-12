import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";

export interface StoreOption {
  id: string;
  name: string;
}

// Fetches the store list for main-admin store selectors.
// Returns [] for store users (they don't need it and can't fetch it).
export function useStores(): StoreOption[] {
  const { user } = useAuth();
  const [stores, setStores] = useState<StoreOption[]>([]);
  useEffect(() => {
    if (user?.role === "MAIN_ADMIN") {
      api.get<StoreOption[]>("/stores").then(setStores).catch(() => setStores([]));
    }
  }, [user?.role]);
  return stores;
}
