"use client";

import { ArrowLeft, ClipboardList, RefreshCw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatUserDateTime } from "@/components/cliproom/date-format";
import { auditLogRetentionDays } from "@/lib/cliproom/shared";
import type { AuditLogEntry, AuditLogResponse } from "@/lib/cliproom/shared";

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMetadataValue(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatMetadata(metadata: string | null) {
  if (!metadata) return "";
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${titleCase(key)}: ${formatMetadataValue(value)}`)
      .join(" / ");
  } catch {
    return metadata;
  }
}

async function fetchAuditLogs() {
  const response = await fetch("/api/cliproom/audit?limit=150", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Partial<AuditLogResponse> & { error?: string }) : {};
  if (!response.ok) throw new Error(data.error ?? "Could not load audit logs.");
  return data.logs ?? [];
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function refreshLogs() {
    setError("");
    setRefreshing(true);
    try {
      setLogs(await fetchAuditLogs());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load audit logs.");
      setLogs([]);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialLogs() {
      try {
        const nextLogs = await fetchAuditLogs();
        if (cancelled) return;
        setLogs(nextLogs);
        setError("");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load audit logs.");
        setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitialLogs();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#0b0b0d] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#0b0b0d]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
          <Link
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.035] px-3 text-sm font-bold text-white/62 hover:border-[#9146ff]/30 hover:bg-[#9146ff]/10 hover:text-[#d8c6ff]"
            href="/"
          >
            <ArrowLeft aria-hidden="true" size={17} />
            Back to ClipRoom
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-[#9146ff]/24 bg-[#9146ff]/10 px-3 py-1.5 text-xs font-bold text-[#d8c6ff] sm:inline-flex">
              <ShieldCheck aria-hidden="true" size={14} />
              Admin
            </span>
            <button
              className="grid h-10 w-10 place-items-center rounded-[10px] border border-white/[0.08] bg-white/[0.035] text-white/48 hover:border-white/14 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              disabled={loading || refreshing}
              onClick={() => void refreshLogs()}
              title="Refresh logs"
              type="button"
            >
              <RefreshCw aria-hidden="true" className={refreshing ? "animate-spin" : ""} size={17} />
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-white/[0.07] pb-5">
          <div>
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#9146ff]/24 bg-[#9146ff]/10 text-[#d8c6ff]">
              <ClipboardList aria-hidden="true" size={18} />
            </div>
            <h1 className="text-[30px] font-black leading-none sm:text-[36px]">Audit logs</h1>
            <p className="mt-3 text-sm leading-6 text-white/42">
              Recent admin and workflow activity across ClipRoom. (Logs are automatically deleted after {auditLogRetentionDays} days.)
            </p>
          </div>
          <p className="hidden text-sm text-white/34 sm:block">
            {logs.length} {logs.length === 1 ? "entry" : "entries"}
          </p>
        </div>

        {error ? (
          <div className="rounded-[14px] border border-[#ff6b6b]/24 bg-[#ff6b6b]/8 p-4 text-sm text-[#ffc4c4]">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[14px] border border-white/[0.075] bg-[#141416] p-6 text-sm text-white/42">
            Loading audit logs...
          </div>
        ) : !error && logs.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-white/[0.12] bg-white/[0.018] p-10 text-center">
            <p className="text-lg font-black">No audit logs yet</p>
            <p className="mt-2 text-sm text-white/42">New workflow and admin actions will show up here.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06] overflow-hidden rounded-[14px] border border-white/[0.075] bg-[#141416]">
            {logs.map((log) => {
              const metadata = formatMetadata(log.metadata);
              return (
                <article
                  key={log.id}
                  className="grid gap-3 px-4 py-4 md:grid-cols-[9rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center"
                >
                  <time className="text-xs font-semibold text-white/36" dateTime={log.createdAt}>
                    {formatUserDateTime(log.createdAt)}
                  </time>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{titleCase(log.action)}</p>
                    <p className="mt-1 text-xs text-white/34">
                      {titleCase(log.targetKind)}
                      {log.targetId ? ` - ${log.targetId.slice(0, 12)}` : ""}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white/68" title={log.targetTitle ?? "Room"}>
                      {log.targetTitle ?? "Room"}
                    </p>
                    <p className="mt-1 text-xs text-white/34">Target</p>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white/68">@{log.actorUsername}</span>
                      {log.actorRole ? (
                        <span className="rounded border border-[#9146ff]/24 bg-[#9146ff]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#d8c6ff]">
                          {log.actorRole}
                        </span>
                      ) : null}
                    </div>
                    {metadata ? (
                      <p className="mt-1 truncate text-xs text-white/34" title={metadata}>
                        {metadata}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-white/24">No extra details</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
