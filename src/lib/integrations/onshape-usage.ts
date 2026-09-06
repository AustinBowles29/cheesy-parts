import { AsyncLocalStorage } from "node:async_hooks";

interface OnshapeUsageStore {
  label: string;
  count: number;
}

const usageStorage = new AsyncLocalStorage<OnshapeUsageStore>();

// Count one request that Onshape will bill against the annual limit. Callers
// invoke this only for 2xx/3xx responses, matching Onshape's own accounting.
export function recordOnshapeCall() {
  const store = usageStorage.getStore();
  if (store) {
    store.count += 1;
  }
}

// Run an operation and log how many billable Onshape calls it made, so the
// Vercel function logs show the real per-action cost. A nested operation
// shares the outer count instead of logging separately.
export async function withOnshapeUsage<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (usageStorage.getStore()) {
    return operation();
  }

  const store: OnshapeUsageStore = { label, count: 0 };
  try {
    return await usageStorage.run(store, operation);
  } finally {
    if (store.count > 0) {
      console.info(
        `[onshape-api] ${label}: ${store.count} call${store.count === 1 ? "" : "s"}`,
      );
    }
  }
}
