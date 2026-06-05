"use client";

import {
  Boxes,
  CopyPlus,
  Database,
  FileText,
  GitBranch,
  Filter,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MACHINE_TYPES, STATUSES } from "@/lib/constants";
import { coerceStatus } from "@/lib/manufacturing";
import type {
  ManufacturingRequest,
  ManufacturingStatus,
  OnshapeUser,
  SlackUser,
} from "@/lib/types";
import { ToastViewport, useToasts } from "./toast";

interface QueueDashboardProps {
  initialRequests: ManufacturingRequest[];
  initialManufacturingUsers: SlackUser[];
  initialOnshapeUser?: OnshapeUser;
  initialStatusOptions: string[];
  initialTableStatusOptions: Record<string, string[]>;
  initialSyncedAt: string;
  initialError?: string;
}

type Filters = {
  subsystem: string;
  machineType: string;
  status: string;
  submitter: string;
  material: string;
  search: string;
};

const emptyFilters: Filters = {
  subsystem: "",
  machineType: "",
  status: "",
  submitter: "",
  material: "",
  search: "",
};

const queueAutoRefreshMs = 20_000;

function uniqueOptions(
  requests: ManufacturingRequest[],
  selector: (request: ManufacturingRequest) => string,
) {
  return Array.from(
    new Set(requests.map(selector).filter((value) => value.trim().length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

function identityKey(value?: string) {
  return (value ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function identityCandidates(values: Array<string | undefined>) {
  return values.map(identityKey).filter(Boolean);
}

function onshapeIdentityCandidates(user?: OnshapeUser) {
  if (!user) {
    return [];
  }

  const emailLocalPart = user.email?.split("@")[0];
  return identityCandidates([
    user.displayName,
    user.email,
    emailLocalPart,
    ...user.aliases,
  ]);
}

function slackUserIdentityCandidates(user: SlackUser) {
  const emailLocalPart = user.email?.split("@")[0];
  return identityCandidates([
    user.displayName,
    user.email,
    emailLocalPart,
    user.handle,
  ]);
}

function defaultActingUserId(users: SlackUser[], onshapeUser?: OnshapeUser) {
  const onshapeCandidateSet = new Set(onshapeIdentityCandidates(onshapeUser));
  const matchingUser =
    onshapeCandidateSet.size > 0
      ? users.find((user) =>
          slackUserIdentityCandidates(user).some((candidate) =>
            onshapeCandidateSet.has(candidate),
          ),
        )
      : undefined;

  return matchingUser?.slackUserId ?? users[0]?.slackUserId ?? "";
}

type SelectOption = {
  label: string;
  value: string;
};

function statusMatches(status: string, selectedStatus: string) {
  return (
    status === selectedStatus ||
    coerceStatus(status) === coerceStatus(selectedStatus)
  );
}

function buildStatusOptions(labels: readonly string[]): SelectOption[] {
  const seen = new Set<string>();
  const options: SelectOption[] = [];

  for (const label of labels) {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      continue;
    }

    const value = coerceStatus(trimmedLabel);
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    options.push({ label: trimmedLabel, value });
  }

  return options;
}

function statusTone(status: ManufacturingStatus) {
  const normalizedStatus = coerceStatus(status);

  if (normalizedStatus === "Manufacturing In Progress") {
    return "bg-[#fff2cf] text-[#7c5608]";
  }

  if (
    normalizedStatus === "Ready for Assembly" ||
    normalizedStatus === "Done for Spares"
  ) {
    return "bg-[#eef5ff] text-[#0b3d91]";
  }

  if (normalizedStatus === "Needs CAM" || normalizedStatus === "Needs Drawing") {
    return "bg-[#f8e7e2] text-[#87392b]";
  }

  return "bg-[#e7edf5] text-[#254668]";
}

function initialQueueToasts(initialError?: string) {
  if (!initialError) {
    return [];
  }

  return [
    {
      variant: "danger" as const,
      title: "Queue load failed",
      message: initialError,
    },
  ];
}

function formatLastSynced(value: string | null) {
  if (!value) {
    return "Not synced yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function QueueDashboard({
  initialRequests,
  initialManufacturingUsers,
  initialOnshapeUser,
  initialStatusOptions,
  initialTableStatusOptions,
  initialSyncedAt,
  initialError,
}: QueueDashboardProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    initialSyncedAt,
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const refreshInFlightRef = useRef(false);
  const mutationCountRef = useRef(0);
  const manufacturingUsers = useMemo(
    () => {
      const users =
        initialManufacturingUsers.length > 0
          ? initialManufacturingUsers
          : [
              {
                slackUserId: "local-manufacturing",
                displayName: "Manufacturing",
              },
            ];

      return [...users].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
    },
    [initialManufacturingUsers],
  );
  const [actingUserId, setActingUserId] = useState(() =>
    defaultActingUserId(manufacturingUsers, initialOnshapeUser),
  );
  const [spareQuantities, setSpareQuantities] = useState<Record<string, string>>(
    {},
  );
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const { toasts, addToast, dismissToast } = useToasts(
    initialQueueToasts(initialError),
  );
  const actingUser =
    manufacturingUsers.find((user) => user.slackUserId === actingUserId) ??
    manufacturingUsers[0];

  const options = useMemo(
    () => ({
      subsystem: uniqueOptions(requests, (request) => request.subsystem),
      submitter: uniqueOptions(requests, (request) => request.submitter),
      material: uniqueOptions(requests, (request) => request.material),
    }),
    [requests],
  );
  const statusOptions = useMemo(() => {
    const labels =
      initialStatusOptions.length > 0 ? initialStatusOptions : STATUSES;

    return buildStatusOptions([
      ...labels,
      ...requests.map((request) => request.status),
    ]);
  }, [initialStatusOptions, requests]);
  const tableStatusOptions = useMemo(() => {
    return Object.fromEntries(
      Object.entries(initialTableStatusOptions).map(([table, labels]) => [
        table,
        buildStatusOptions(
          labels.length > 0
            ? labels
            : statusOptions.map((option) => option.label),
        ),
      ]),
    );
  }, [initialTableStatusOptions, statusOptions]);

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      const searchTarget = [
        request.partName,
        request.partNumber,
        request.notes,
        request.subsystem,
        request.material,
        request.machineType,
        request.airtableTableName,
        request.airtableTableId,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!filters.subsystem || request.subsystem === filters.subsystem) &&
        (!filters.machineType || request.machineType === filters.machineType) &&
        (!filters.status || statusMatches(request.status, filters.status)) &&
        (!filters.submitter || request.submitter === filters.submitter) &&
        (!filters.material || request.material === filters.material) &&
        (!filters.search ||
          searchTarget.includes(filters.search.toLowerCase().trim()))
      );
    });
  }, [filters, requests]);

  const statusCounts = useMemo(() => {
    return statusOptions.map((option) => ({
      ...option,
      count: requests.filter((request) =>
        statusMatches(request.status, option.value),
      ).length,
    }));
  }, [requests, statusOptions]);

  function statusOptionsForRequest(request: ManufacturingRequest) {
    const tableOptions =
      tableStatusOptions[request.airtableTableId ?? ""] ??
      tableStatusOptions[request.airtableTableName ?? ""];
    const optionsForRequest = tableOptions ?? statusOptions;
    const currentStatus = coerceStatus(request.status);

    if (optionsForRequest.some((option) => option.value === currentStatus)) {
      return optionsForRequest;
    }

    return [
      ...optionsForRequest,
      { label: request.status, value: currentStatus },
    ];
  }

  function showWarnings(warnings: string[] = []) {
    for (const warning of warnings) {
      if (warning.toLowerCase().includes("slack")) {
        addToast({
          variant: "info",
          title: "Slack not configured",
          message:
            "Changes are saved, but Slack notifications will not be sent.",
        });
      } else {
        addToast({
          variant: "warning",
          title: "Integration warning",
          message: warning,
        });
      }
    }
  }

  const refreshQueue = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (refreshInFlightRef.current) {
        return;
      }

      if (silent && mutationCountRef.current > 0) {
        return;
      }

      refreshInFlightRef.current = true;
      setIsRefreshing(true);

      try {
        const response = await fetch("/api/requests", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) {
          if (!silent) {
            addToast({
              variant: "danger",
              title: "Refresh failed",
              message: body.error ?? "Could not refresh queue.",
            });
          }
          return;
        }

        setRequests(body.data);
        setLastSyncedAt(new Date().toISOString());

        if (!silent) {
          addToast({
            variant: "success",
            title: "Queue refreshed",
            message: "Latest manufacturing requests loaded.",
          });
        }
      } catch (error) {
        if (!silent) {
          addToast({
            variant: "danger",
            title: "Refresh failed",
            message:
              error instanceof Error ? error.message : "Could not refresh queue.",
          });
        }
      } finally {
        refreshInFlightRef.current = false;
        setIsRefreshing(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshQueue({ silent: true });
      }
    }, queueAutoRefreshMs);

    return () => window.clearInterval(intervalId);
  }, [refreshQueue]);

  useEffect(() => {
    function refreshIfVisible() {
      if (document.visibilityState === "visible") {
        void refreshQueue({ silent: true });
      }
    }

    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [refreshQueue]);

  async function updateStatus(id: string, status: ManufacturingStatus) {
    mutationCountRef.current += 1;
    const previous = requests;
    const previousRequest = requests.find((request) => request.id === id);
    setRequests((current) =>
      current.map((request) =>
        request.id === id ? { ...request, status: coerceStatus(status) } : request,
      ),
    );

    try {
      const response = await fetch(
        `/api/requests/${encodeURIComponent(id)}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            changedBy: actingUser.displayName,
            changedBySlackId: actingUser.slackUserId,
            airtableTableId: previousRequest?.airtableTableId,
            airtableTableName: previousRequest?.airtableTableName,
          }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        setRequests(previous);
        addToast({
          variant: "danger",
          title: "Status update failed",
          message: body.error ?? "Could not update status.",
        });
        return;
      }

      setRequests((current) =>
        current.map((request) => (request.id === id ? body.data : request)),
      );
      setLastSyncedAt(new Date().toISOString());
      if (body.warnings?.length) {
        showWarnings(body.warnings);
      }
      addToast({
        variant: "success",
        title: "Status updated",
        message: `${body.data.partName ?? previousRequest?.partName ?? "Part"} moved from ${
          previousRequest?.status ?? "the previous status"
        } to ${body.data.status}.`,
      });
    } catch (error) {
      setRequests(previous);
      addToast({
        variant: "danger",
        title: "Status update failed",
        message:
          error instanceof Error ? error.message : "Could not update status.",
      });
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
    }

    void refreshQueue({ silent: true });
  }

  async function createSpares(request: ManufacturingRequest) {
    mutationCountRef.current += 1;
    const spareQuantity = spareQuantities[request.id] ?? "1";

    try {
      const response = await fetch(
        `/api/requests/${encodeURIComponent(request.id)}/spares`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spareQuantity,
            submitter: actingUser.displayName,
            submitterSlackId: actingUser.slackUserId,
            airtableTableId: request.airtableTableId,
            airtableTableName: request.airtableTableName,
          }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        addToast({
          variant: "danger",
          title: "Spares failed",
          message: body.error ?? "Could not create spare request.",
        });
        return;
      }

      setRequests((current) => [body.data, ...current]);
      setLastSyncedAt(new Date().toISOString());
      if (body.warnings?.length) {
        showWarnings(body.warnings);
      }
      addToast({
        variant: "success",
        title: "Spares created",
        message: `${spareQuantity} spare request${
          spareQuantity === "1" ? "" : "s"
        } added for ${request.partName}.`,
      });
    } catch (error) {
      addToast({
        variant: "danger",
        title: "Spares failed",
        message:
          error instanceof Error ? error.message : "Could not create spare request.",
      });
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
    }

    void refreshQueue({ silent: true });
  }

  async function deleteRequest(request: ManufacturingRequest) {
    const label = request.partNumber || request.partName;
    if (
      !window.confirm(
        `Delete ${label} from the queue and Airtable? This cannot be undone from this app.`,
      )
    ) {
      return;
    }

    mutationCountRef.current += 1;
    setDeletingIds((current) => new Set(current).add(request.id));
    const previous = requests;
    setRequests((current) => current.filter((item) => item.id !== request.id));

    try {
      const response = await fetch(
        `/api/requests/${encodeURIComponent(request.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            airtableTableId: request.airtableTableId,
            airtableTableName: request.airtableTableName,
          }),
        },
      );
      const body = await response.json();

      if (!response.ok) {
        setRequests(previous);
        addToast({
          variant: "danger",
          title: "Delete failed",
          message: body.error ?? "Could not delete request.",
        });
        return;
      }

      setLastSyncedAt(new Date().toISOString());
      addToast({
        variant: "success",
        title: "Part deleted",
        message: `${label} was removed from the queue and Airtable.`,
      });
    } catch (error) {
      setRequests(previous);
      addToast({
        variant: "danger",
        title: "Delete failed",
        message:
          error instanceof Error ? error.message : "Could not delete request.",
      });
    } finally {
      mutationCountRef.current = Math.max(0, mutationCountRef.current - 1);
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
    }

    void refreshQueue({ silent: true });
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7faff] text-[#141515]">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <div className="page-transition mx-auto flex w-full max-w-7xl flex-col gap-6 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[#d8e2f0] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-[#0b3d91]">
              Team 254 Manufacturing
            </p>
            <h1 className="mt-1 text-3xl font-semibold">Fabrication queue</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex h-10 items-center gap-2 whitespace-nowrap text-sm font-semibold text-[#5c6f8a]">
              <span>Acting as</span>
              <select
                value={actingUserId}
                onChange={(event) => setActingUserId(event.target.value)}
                className="h-10 min-w-48 rounded-md border border-[#b8c9e3] bg-white px-3 text-sm font-medium text-[#141515] outline-none focus:border-[#0b3d91] focus:shadow-[0_0_0_2px_rgb(11_61_145_/_18%)]"
              >
                {manufacturingUsers.map((user) => (
                  <option key={user.slackUserId} value={user.slackUserId}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div
              aria-live="polite"
              className="flex h-10 items-center whitespace-nowrap text-xs font-medium text-[#5c6f8a]"
            >
              {isRefreshing
                ? "Syncing..."
                : `Last synced ${formatLastSynced(lastSyncedAt)}`}
            </div>
            <button
              type="button"
              onClick={() => void refreshQueue({ silent: false })}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
              className="interactive inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c9e3] bg-white px-3 text-sm font-medium hover:bg-[#edf4ff]"
            >
              <RefreshCw
                size={17}
                aria-hidden="true"
                className={isRefreshing ? "animate-spin" : undefined}
              />
              Refresh
            </button>
            <Link
              href="/onshape"
              className="interactive inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0b3d91] px-3 text-sm font-semibold text-white hover:bg-[#082f6f]"
            >
              <Boxes size={17} aria-hidden="true" />
              Submit part
            </Link>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusCard
            label="All"
            count={requests.length}
            active={!filters.status}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: "",
              }))
            }
          />
          {statusCounts.map((item) => (
            <StatusCard
              key={item.value}
              label={item.label}
              count={item.count}
              active={filters.status === item.value}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  status: item.value,
                }))
              }
            />
          ))}
        </section>

        <section className="rounded-lg border border-[#d8e2f0] bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[#0b3d91]">
            <Filter size={17} aria-hidden="true" />
            Filters
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="field compact">
              <span>Search</span>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6b756b]"
                  aria-hidden="true"
                />
                <input
                  className="pl-9"
                  value={filters.search}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      search: event.target.value,
                    }))
                  }
                />
              </div>
            </label>
            <FilterSelect
              label="Subsystem"
              value={filters.subsystem}
              options={options.subsystem}
              onChange={(value) =>
                setFilters((current) => ({ ...current, subsystem: value }))
              }
            />
            <FilterSelect
              label="Machine type"
              value={filters.machineType}
              options={MACHINE_TYPES}
              onChange={(value) =>
                setFilters((current) => ({ ...current, machineType: value }))
              }
            />
            <FilterSelect
              label="Status"
              value={filters.status}
              options={statusOptions}
              onChange={(value) =>
                setFilters((current) => ({ ...current, status: value }))
              }
            />
            <FilterSelect
              label="Submitter"
              value={filters.submitter}
              options={options.submitter}
              onChange={(value) =>
                setFilters((current) => ({ ...current, submitter: value }))
              }
            />
            <FilterSelect
              label="Material"
              value={filters.material}
              options={options.material}
              onChange={(value) =>
                setFilters((current) => ({ ...current, material: value }))
              }
            />
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="interactive mt-6 h-10 rounded-md border border-[#b8c9e3] bg-white px-3 text-sm font-medium hover:bg-[#edf4ff]"
            >
              Clear filters
            </button>
          </div>
        </section>

        <section className="max-w-full overflow-hidden rounded-lg border border-[#d8e2f0] bg-white">
          <div className="scrollable queue-table-scroll">
            <table className="queue-table w-full border-collapse text-xs sm:text-sm">
              <colgroup>
                <col className="w-[16%]" />
                <col className="w-[9%]" />
                <col className="w-[4%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[7%]" />
                <col className="w-[14%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="bg-[#edf4ff] text-left text-xs uppercase text-[#5c6f8a]">
                <tr>
                  <th className="px-1 py-3 sm:px-3">Part</th>
                  <th className="px-1 py-3 sm:px-3">Part Number</th>
                  <th className="px-1 py-3 sm:px-3">Qty</th>
                  <th className="px-1 py-3 sm:px-3">Subsystem</th>
                  <th className="px-1 py-3 sm:px-3">Material</th>
                  <th className="px-1 py-3 sm:px-3">Machine</th>
                  <th className="px-1 py-3 sm:px-3">Status</th>
                  <th className="px-1 py-3 sm:px-3">Table</th>
                  <th className="px-1 py-3 sm:px-3">Spares</th>
                  <th className="px-1 py-3 sm:px-3">Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => {
                  const rowStatusOptions = statusOptionsForRequest(request);

                  return (
                    <tr
                      key={request.id}
                      className="border-t border-[#d8e2f0] align-top"
                    >
                    <td className="px-1 py-3 sm:px-3">
                      <div className="font-medium">{request.partName}</div>
                      {request.notes && (
                        <div className="mt-1 text-xs text-[#5c6f8a]">
                          {request.notes}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-[#586158]">
                        {request.submitter || "Unknown submitter"}
                      </div>
                    </td>
                    <td className="px-1 py-3 sm:px-3">
                      {request.partNumber || "-"}
                    </td>
                    <td className="px-1 py-3 sm:px-3">{request.quantity}</td>
                    <td className="px-1 py-3 sm:px-3">
                      {request.subsystem || "-"}
                    </td>
                    <td className="px-1 py-3 sm:px-3">
                      <div>{request.material || "-"}</div>
                      <div className="mt-1 text-xs text-[#586158]">
                        {request.thickness || "No thickness"}
                      </div>
                    </td>
                    <td className="px-1 py-3 sm:px-3">{request.machineType}</td>
                    <td className="px-1 py-3 sm:px-3">
                      <select
                        value={coerceStatus(request.status)}
                        onChange={(event) =>
                          updateStatus(
                            request.id,
                            event.target.value as ManufacturingStatus,
                          )
                        }
                        className={`h-9 w-full min-w-0 rounded-md border-0 px-1 text-xs font-semibold ${statusTone(
                          request.status,
                        )}`}
                      >
                        {rowStatusOptions.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-3 text-xs text-[#5c6f8a] sm:px-3">
                      {request.airtableTableName ||
                        request.airtableTableId ||
                        "-"}
                    </td>
                    <td className="px-1 py-3 sm:px-3">
                      <div className="queue-table-actions">
                        <input
                          aria-label="Set spare quantity"
                          title="Set spare quantity"
                          type="number"
                          min="1"
                          value={spareQuantities[request.id] ?? "1"}
                          onChange={(event) =>
                            setSpareQuantities((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                          className="h-9 w-full max-w-16 min-w-0 rounded-md border border-[#b8c9e3] px-1"
                        />
                        <button
                          type="button"
                          title="Make spares"
                          aria-label="Make spares"
                          onClick={() => createSpares(request)}
                          className="icon-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#b8c9e3] hover:bg-[#edf4ff] sm:h-9 sm:w-9"
                        >
                          <CopyPlus size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td className="px-1 py-3 sm:px-3">
                      <div className="queue-table-actions">
                        <LinkButton
                          href={request.onshapePartUrl}
                          title="Open Onshape part"
                          icon={<Boxes size={16} aria-hidden="true" />}
                        />
                        <LinkButton
                          href={request.onshapeDrawingUrl}
                          title="Open drawing"
                          icon={<FileText size={16} aria-hidden="true" />}
                        />
                        <LinkButton
                          href={request.assemblyUrl}
                          title="Open branch/version"
                          icon={<GitBranch size={16} aria-hidden="true" />}
                        />
                        <LinkButton
                          href={request.airtableUrl}
                          title="Open Airtable record"
                          icon={<Database size={16} aria-hidden="true" />}
                        />
                        <button
                          type="button"
                          title="Delete part"
                          aria-label={`Delete ${request.partNumber || request.partName}`}
                          onClick={() => deleteRequest(request)}
                          disabled={deletingIds.has(request.id)}
                          className="icon-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#b8c9e3] text-[#5c6f8a] hover:border-[#dc2626] hover:bg-[#fef2f2] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    </tr>
                  );
                })}
                {filteredRequests.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-1 py-10 text-center text-sm text-[#586158] sm:px-3"
                    >
                      No manufacturing requests match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (string | SelectOption)[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => {
          const normalizedOption =
            typeof option === "string"
              ? { label: option, value: option }
              : option;

          return (
            <option
              key={`${normalizedOption.value}:${normalizedOption.label}`}
              value={normalizedOption.value}
            >
              {normalizedOption.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function StatusCard({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`interactive cursor-pointer rounded-lg border p-3 text-left ${
        active
          ? "border-[#0b3d91] bg-[#eef5ff] shadow-[0_0_0_1px_#0b3d91]"
          : "border-[#d8e2f0] bg-white hover:border-[#0b3d91] hover:bg-[#edf4ff]"
      }`}
    >
      <span className="text-2xl font-semibold">{count}</span>
      <span
        className={`mt-1 block text-sm ${active ? "text-[#0b3d91]" : "text-[#5c6f8a]"}`}
      >
        {label}
      </span>
    </button>
  );
}

function LinkButton({
  href,
  title,
  icon,
}: {
  href?: string;
  title: string;
  icon: ReactNode;
}) {
  if (!href) {
    return (
      <span
        title={`${title} unavailable`}
        aria-label={`${title} unavailable`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#d8e2f0] text-[#9aa9bc] sm:h-9 sm:w-9"
      >
        {icon}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={title}
      className="icon-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#b8c9e3] hover:bg-[#edf4ff] sm:h-9 sm:w-9"
    >
      {icon}
    </a>
  );
}
