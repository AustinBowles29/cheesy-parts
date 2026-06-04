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
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { CATEGORIES, MACHINE_TYPES, STATUSES } from "@/lib/constants";
import type {
  ManufacturingRequest,
  ManufacturingStatus,
  SlackUser,
} from "@/lib/types";
import { ToastViewport, useToasts } from "./toast";

interface QueueDashboardProps {
  initialRequests: ManufacturingRequest[];
  initialManufacturingUsers: SlackUser[];
  initialError?: string;
}

type Filters = {
  subsystem: string;
  machineType: string;
  status: string;
  category: string;
  submitter: string;
  material: string;
  search: string;
};

const emptyFilters: Filters = {
  subsystem: "",
  machineType: "",
  status: "",
  category: "",
  submitter: "",
  material: "",
  search: "",
};

function uniqueOptions(
  requests: ManufacturingRequest[],
  selector: (request: ManufacturingRequest) => string,
) {
  return Array.from(
    new Set(requests.map(selector).filter((value) => value.trim().length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

function statusTone(status: ManufacturingStatus) {
  if (status === "Manufacturing In Progress") {
    return "bg-[#fff2cf] text-[#7c5608]";
  }

  if (status === "Ready for Assembly" || status === "Done for Spares") {
    return "bg-[#eef5ff] text-[#0b3d91]";
  }

  if (status === "Needs CAM" || status === "Needs Drawing") {
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

export function QueueDashboard({
  initialRequests,
  initialManufacturingUsers,
  initialError,
}: QueueDashboardProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const manufacturingUsers =
    initialManufacturingUsers.length > 0
      ? initialManufacturingUsers
      : [{ slackUserId: "local-manufacturing", displayName: "Manufacturing" }];
  const [actingUserId, setActingUserId] = useState(
    manufacturingUsers[0].slackUserId,
  );
  const [spareQuantities, setSpareQuantities] = useState<Record<string, string>>(
    {},
  );
  const { toasts, addToast, dismissToast } = useToasts(
    initialQueueToasts(initialError),
  );
  const [isPending, startTransition] = useTransition();
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

  const filteredRequests = useMemo(() => {
    return requests.filter((request) => {
      const searchTarget = [
        request.partName,
        request.partNumber,
        request.notes,
        request.subsystem,
        request.material,
        request.machineType,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!filters.subsystem || request.subsystem === filters.subsystem) &&
        (!filters.machineType || request.machineType === filters.machineType) &&
        (!filters.status || request.status === filters.status) &&
        (!filters.category || request.category === filters.category) &&
        (!filters.submitter || request.submitter === filters.submitter) &&
        (!filters.material || request.material === filters.material) &&
        (!filters.search ||
          searchTarget.includes(filters.search.toLowerCase().trim()))
      );
    });
  }, [filters, requests]);

  const statusCounts = useMemo(() => {
    return STATUSES.map((status) => ({
      status,
      count: requests.filter((request) => request.status === status).length,
    }));
  }, [requests]);

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

  async function refreshQueue() {
    const response = await fetch("/api/requests");
    const body = await response.json();
    if (!response.ok) {
      addToast({
        variant: "danger",
        title: "Refresh failed",
        message: body.error ?? "Could not refresh queue.",
      });
      return;
    }

    setRequests(body.data);
    addToast({
      variant: "success",
      title: "Queue refreshed",
      message: "Latest manufacturing requests loaded.",
    });
  }

  async function updateStatus(id: string, status: ManufacturingStatus) {
    const previous = requests;
    const previousRequest = requests.find((request) => request.id === id);
    setRequests((current) =>
      current.map((request) =>
        request.id === id ? { ...request, status } : request,
      ),
    );

    const response = await fetch(`/api/requests/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        changedBy: actingUser.displayName,
        changedBySlackId: actingUser.slackUserId,
      }),
    });
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
  }

  async function createSpares(request: ManufacturingRequest) {
    const spareQuantity = spareQuantities[request.id] ?? "1";

    const response = await fetch(
      `/api/requests/${encodeURIComponent(request.id)}/spares`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spareQuantity,
          submitter: actingUser.displayName,
          submitterSlackId: actingUser.slackUserId,
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
  }

  return (
    <main className="min-h-screen bg-[#f7faff] text-[#141515]">
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
      <div className="page-transition mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
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
            <button
              type="button"
              onClick={() => startTransition(refreshQueue)}
              className="interactive inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c9e3] bg-white px-3 text-sm font-medium hover:bg-[#edf4ff]"
            >
              <RefreshCw size={17} aria-hidden="true" />
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
              key={item.status}
              label={item.status}
              count={item.count}
              active={filters.status === item.status}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  status: item.status,
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
              options={STATUSES}
              onChange={(value) =>
                setFilters((current) => ({ ...current, status: value }))
              }
            />
            <FilterSelect
              label="Category"
              value={filters.category}
              options={CATEGORIES}
              onChange={(value) =>
                setFilters((current) => ({ ...current, category: value }))
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

        <section className="overflow-hidden rounded-lg border border-[#d8e2f0] bg-white">
          <div className="scrollable overflow-x-auto">
            <table className="w-full min-w-[1280px] border-collapse text-sm">
              <thead className="bg-[#edf4ff] text-left text-xs uppercase text-[#5c6f8a]">
                <tr>
                  <th className="px-3 py-3">Part</th>
                  <th className="px-3 py-3">Part Number</th>
                  <th className="px-3 py-3">Qty</th>
                  <th className="px-3 py-3">Subsystem</th>
                  <th className="px-3 py-3">Material</th>
                  <th className="px-3 py-3">Machine</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Spares</th>
                  <th className="px-3 py-3">Links</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.map((request) => (
                  <tr
                    key={request.id}
                    className="border-t border-[#d8e2f0] align-top"
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium">{request.partName}</div>
                      {request.notes && (
                        <div className="mt-1 max-w-56 text-xs text-[#5c6f8a]">
                          {request.notes}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-[#586158]">
                        {request.submitter || "Unknown submitter"}
                      </div>
                    </td>
                    <td className="px-3 py-3">{request.partNumber || "-"}</td>
                    <td className="px-3 py-3">{request.quantity}</td>
                    <td className="px-3 py-3">{request.subsystem || "-"}</td>
                    <td className="px-3 py-3">
                      <div>{request.material || "-"}</div>
                      <div className="mt-1 text-xs text-[#586158]">
                        {request.thickness || "No thickness"}
                      </div>
                    </td>
                    <td className="px-3 py-3">{request.machineType}</td>
                    <td className="px-3 py-3">
                      <select
                        value={request.status}
                        onChange={(event) =>
                          updateStatus(
                            request.id,
                            event.target.value as ManufacturingStatus,
                          )
                        }
                        className={`h-9 rounded-md border-0 px-2 text-xs font-semibold ${statusTone(
                          request.status,
                        )}`}
                      >
                        {STATUSES.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-[#e7edf5] px-2 py-1 text-xs font-semibold text-[#254668]">
                        {request.category}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
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
                          className="h-9 w-16 rounded-md border border-[#b8c9e3] px-2"
                        />
                        <button
                          type="button"
                          title="Make spares"
                          aria-label="Make spares"
                          onClick={() => createSpares(request)}
                          className="icon-action inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#b8c9e3] hover:bg-[#edf4ff]"
                        >
                          <CopyPlus size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
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
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredRequests.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-10 text-center text-sm text-[#586158]"
                    >
                      No manufacturing requests match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {isPending && (
          <div className="fixed bottom-4 right-4 rounded-md bg-[#0b3d91] px-3 py-2 text-sm text-white">
            Updating queue
          </div>
        )}
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
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
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
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d8e2f0] text-[#9aa9bc]"
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
      className="icon-action inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#b8c9e3] hover:bg-[#edf4ff]"
    >
      {icon}
    </a>
  );
}
