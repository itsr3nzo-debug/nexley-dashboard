'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallLog } from '@/lib/types'
import { formatDuration, formatDateTime, callerDisplayName } from '@/lib/format'
import { STATUS_CONFIG, DIRECTION_CONFIG } from '@/lib/constants'
import TranscriptBubbles from '@/components/shared/TranscriptBubbles'
import EmptyState from '@/components/shared/EmptyState'
import { ChevronRight, Phone, Search, MessageSquare, Send, X } from 'lucide-react'
import { StatusBadge, DirectionBadge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

const AudioPlayer = dynamic(() => import('@/components/shared/AudioPlayer'), { ssr: false })

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  // Stable ref to avoid re-creating on every render
  const supabaseRef = useRef(createClient())

  const fetchCalls = useCallback(async () => {
    setLoading(true)
    const supabase = supabaseRef.current
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const clientId = user.app_metadata?.client_id
    if (!clientId) { setLoading(false); return }

    // Escape wildcards in search to prevent pattern injection
    const safeSearch = search.replace(/[%_]/g, '\\$&')

    let query = supabase
      .from('call_logs')
      .select('*, contacts(first_name, last_name, phone)')
      .eq('client_id', clientId)
      .order('started_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter)
    }

    if (safeSearch.length >= 3) {
      query = query.ilike('from_number', `%${safeSearch}%`)
    }

    const { data, error } = await query
    if (error) console.error('Failed to fetch calls:', error.message)
    setCalls((data ?? []) as CallLog[])
    setLoading(false)
  }, [page, statusFilter, search])

  useEffect(() => {
    fetchCalls()
  }, [fetchCalls])

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Call log</h1>
          <p className="text-sm mt-1 text-muted-foreground">Transcripts + outcomes for every voice call handled by your AI Employee</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by phone..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="pl-9 pr-4 py-2 rounded-lg border text-sm outline-none bg-card text-foreground border-border focus:ring-2 focus:ring-ring min-w-[200px]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="px-4 py-2 rounded-lg border text-sm outline-none bg-card text-foreground border-border focus:ring-2 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="no_answer">No answer</option>
          <option value="voicemail">Voicemail</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {/* Table — uses the v2 <Table> primitive (border-separated, hairline
          dividers, sticky header, small-caps column titles via the @table
          token mapping). Drops the `shadow-sm` outer wrapper that broke the
          dashboard's "no shadows on chrome" rule. */}
      {loading ? (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border">
            <div className="grid grid-cols-6 gap-4 px-4 py-2.5 bg-muted/30">
              {[0,1,2,3,4,5].map(i => <div key={i} className="skeleton h-3 w-16 rounded" />)}
            </div>
            {[0,1,2,3,4].map(i => (
              <div key={i} className="grid grid-cols-6 gap-4 px-4 py-2.5">
                <div className="skeleton h-4 w-28 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-12 rounded" />
                <div className="skeleton h-4 w-16 rounded" />
                <div className="skeleton h-4 w-24 rounded" />
                <div className="skeleton h-4 w-32 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : calls.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={MessageSquare}
            title="No conversations yet"
            description={search || statusFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Conversations will appear here once your AI Employee starts handling messages.'}
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table stickyHeader>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date &amp; Time</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const sc = STATUS_CONFIG[call.status]
                  const dc = DIRECTION_CONFIG[call.direction]
                  const caller = callerDisplayName(call)
                  const isExpanded = expandedId === call.id
                  const hasDetail = call.summary || call.transcript

                  return (
                    <CallRow
                      key={call.id}
                      call={call}
                      caller={caller}
                      sc={sc}
                      dc={dc}
                      isExpanded={isExpanded}
                      hasDetail={!!hasDetail}
                      onToggle={() => hasDetail && setExpandedId(prev => prev === call.id ? null : call.id)}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card layout */}
          <div className="md:hidden rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
              {calls.map((call) => {
                const sc = STATUS_CONFIG[call.status]
                const caller = callerDisplayName(call)
                const isExpanded = expandedId === call.id
                const hasDetail = call.summary || call.transcript

                return (
                  <div key={call.id}>
                    <button
                      className="w-full px-4 py-3.5 text-left touch-target"
                      onClick={() => hasDetail && setExpandedId(prev => prev === call.id ? null : call.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-foreground">{caller}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDuration(call.duration_seconds)} · {formatDateTime(call.started_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {sc && (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${sc.className}`}>
                              {sc.label}
                            </span>
                          )}
                          {hasDetail && (
                            <ChevronRight size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && <ExpandedDetail call={call} />}
                  </div>
                )
              })}
            </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 mt-3 rounded-lg border border-border bg-card">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-8 px-3 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              <span className="font-mono tabular-nums">{calls.length}</span> results
              <span className="text-muted-foreground/60 mx-1.5">·</span>
              Page <span className="font-mono tabular-nums">{page + 1}</span>
              {search && <span className="ml-1">for &ldquo;{search}&rdquo;</span>}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={calls.length < PAGE_SIZE}
              className="h-8 px-3 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Desktop table row ─────────────────────────────── */

function CallRow({ call, caller, sc, dc, isExpanded, hasDetail, onToggle }: {
  call: CallLog
  caller: string
  sc: (typeof STATUS_CONFIG)[string] | undefined
  dc: (typeof DIRECTION_CONFIG)[string] | undefined
  isExpanded: boolean
  hasDetail: boolean
  onToggle: () => void
}) {
  return (
    <>
      <TableRow
        onClick={onToggle}
        className={hasDetail ? 'cursor-pointer' : ''}
        data-state={isExpanded ? 'selected' : undefined}
      >
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {hasDetail && (
              <ChevronRight
                size={14}
                strokeWidth={1.5}
                className={`text-muted-foreground transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
              />
            )}
            {caller}
          </div>
        </TableCell>
        <TableCell>
          <DirectionBadge direction={call.direction} />
        </TableCell>
        <TableCell className="text-muted-foreground font-mono tabular-nums">
          {formatDuration(call.duration_seconds)}
        </TableCell>
        <TableCell>
          <StatusBadge status={call.status} />
        </TableCell>
        <TableCell className="text-muted-foreground font-mono tabular-nums">
          {formatDateTime(call.started_at)}
        </TableCell>
        <TableCell className="text-muted-foreground max-w-xs">
          <span className="truncate block">
            {call.summary ? call.summary.slice(0, 80) + (call.summary.length > 80 ? '…' : '') : '—'}
          </span>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/20 p-0">
            <ExpandedDetail call={call} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

/* ── Expanded call detail ──────────────────────────── */

function ExpandedDetail({ call }: { call: CallLog }) {
  const [showSms, setShowSms] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [sending, setSending] = useState(false)

  async function sendSms() {
    // 2026-05-12 — Twilio no longer in use. SMS path is gated server-side and
    // would return 410; surface a clean message instead of letting the user
    // hit it. The calls page is moribund anyway (voice channel dead since
    // 2026-05-05); whole component is a candidate for deletion.
    toast.error('SMS is currently disabled — message the customer on WhatsApp instead.')
    setShowSms(false)
  }

  return (
    <div className="px-6 py-5 space-y-4">
      {call.summary && (
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">AI Summary</p>
          <p className="text-sm text-foreground">{call.summary}</p>
        </div>
      )}

      {call.transcript && Array.isArray(call.transcript) && call.transcript.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Transcript</p>
          <TranscriptBubbles transcript={call.transcript} />
        </div>
      )}

      {call.transcript_text && !Array.isArray(call.transcript) && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Transcript</p>
          <p className="text-sm whitespace-pre-wrap text-foreground">{call.transcript_text}</p>
        </div>
      )}

      {call.recording_url && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Recording</p>
          <AudioPlayer url={call.recording_url} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 pt-2">
        {call.from_number && (
          <a
            href={`tel:${call.from_number}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-primary/10 text-brand-primary transition-colors hover:bg-brand-primary/20"
          >
            <Phone size={12} /> Call Back
          </a>
        )}
        {call.from_number && !showSms && (
          <button
            onClick={() => setShowSms(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-success/10 text-brand-success transition-colors hover:bg-brand-success/20"
          >
            <MessageSquare size={12} /> Send SMS
          </button>
        )}
      </div>

      {/* SMS composer */}
      {showSms && call.from_number && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              SMS to {call.from_number}
            </p>
            <button onClick={() => { setShowSms(false); setSmsText('') }} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          </div>
          <textarea
            value={smsText}
            onChange={e => setSmsText(e.target.value)}
            rows={3}
            maxLength={1600}
            placeholder="Hi, this is your AI Employee following up..."
            className="w-full px-3 py-2 rounded-lg border text-sm bg-card text-foreground border-border focus:ring-2 focus:ring-ring outline-none resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{smsText.length}/1600</span>
            <button
              onClick={sendSms}
              disabled={sending || !smsText.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-success text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send size={12} />
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
