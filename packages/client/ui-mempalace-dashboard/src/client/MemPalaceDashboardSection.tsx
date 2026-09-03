import { useEffect, useState, type ReactNode } from 'react'
import type { MemPalaceDashboardRequest, MemPalaceDashboardSnapshot, MemPalaceUnavailable } from '@deepseek-ai/dsh-api-mempalace-dashboard/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Host API face injected into the dashboard section. */
export interface MemPalaceDashboardSectionInjected {
  /** Read one current dashboard snapshot from the Host. */
  inspect: (request: MemPalaceDashboardRequest) => Promise<MemPalaceDashboardSnapshot>
}

/** Full props assembled by the Settings slot renderer. */
export type MemPalaceDashboardSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'mempalaceDashboard'>
  & InjectFace<MemPalaceDashboardSectionInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: MemPalaceDashboardSnapshot }

const WRAP_STYLE = { display: 'grid', gap: '16px', maxWidth: '860px' }
const FILTER_STYLE = { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, alignItems: 'end' }
const INPUT_STYLE = { display: 'grid', gap: '4px' }
const CARD_STYLE = { border: '1px solid var(--dsw-border-subtle)', borderRadius: '12px', padding: '12px' }
const GRID_STYLE = { display: 'grid', gap: '8px' }
const LIST_STYLE = { margin: 0, paddingInlineStart: '20px' }

/** Render the read-only MemPalace dashboard section. */
export function MemPalaceDashboardSection({ inspect, t }: MemPalaceDashboardSectionProps): ReactNode {

  const [wing, setWing] = useState('')
  const [room, setRoom] = useState('')
  const [query, setQuery] = useState('')
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [request, setRequest] = useState<MemPalaceDashboardRequest>({ limit: 25 })

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void inspect(request).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      (error: unknown) => { if (current) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { current = false }
  }, [inspect, request])

  return (
    <section style={WRAP_STYLE} aria-busy={state.status === 'loading'} data-mempalace-dashboard-status={state.status}>
      <header style={GRID_STYLE}>
        <h3>{t('title')}</h3>
        <p>{t('summary')}</p>
      </header>
      <form style={FILTER_STYLE} onSubmit={(event) => {
        event.preventDefault()
        setRequest({ wing, room, query, limit: 25 })
      }}>
        <label style={INPUT_STYLE}>
          <span>{t('wingFilter')}</span>
          <input value={wing} onChange={(event) => { setWing(event.currentTarget.value) }} />
        </label>
        <label style={INPUT_STYLE}>
          <span>{t('roomFilter')}</span>
          <input value={room} onChange={(event) => { setRoom(event.currentTarget.value) }} />
        </label>
        <label style={INPUT_STYLE}>
          <span>{t('queryFilter')}</span>
          <input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        </label>
        <button type="submit">{t('refresh')}</button>
      </form>
      {state.status === 'loading' ? <p>{t('loading')}</p> : null}
      {state.status === 'error' ? <p role="alert">{t('error')}: {state.message}</p> : null}
      {state.status === 'ready' ? <SnapshotView snapshot={state.snapshot} t={t} /> : null}
    </section>
  )
}

function SnapshotView({ snapshot, t }: {
  readonly snapshot: MemPalaceDashboardSnapshot
  readonly t: MemPalaceDashboardSectionProps['t']
}): ReactNode {
  return (
    <div style={GRID_STYLE}>
      <section style={CARD_STYLE}>
        <h4>{t('provider')}</h4>
        {!snapshot.provider.available ? <UnavailableNotice unavailable={snapshot.provider} /> : (
          <p>{t('providerStatus', {
            state: snapshot.provider.value.state,
            pending: snapshot.provider.value.pendingCaptures,
            starts: snapshot.provider.value.workerStarts,
          })}</p>
        )}
      </section>
      <section style={CARD_STYLE}>
        <h4>{t('location')}</h4>
        {!snapshot.location.available ? <UnavailableNotice unavailable={snapshot.location} /> : (
          <>
            <p>{snapshot.location.value.backend} · {snapshot.location.value.collectionName} · {snapshot.location.value.wing}</p>
            <code>{snapshot.location.value.palacePath}</code>
          </>
        )}
      </section>
      <section style={CARD_STYLE}>
        <h4>{t('structure')}</h4>
        {!snapshot.structure.available ? <UnavailableNotice unavailable={snapshot.structure} /> : (
          <div style={GRID_STYLE}>
            <p>{t('counts', {
              wings: snapshot.structure.value.wingCount,
              rooms: snapshot.structure.value.roomCount,
              drawers: snapshot.structure.value.drawerCount,
            })}</p>
            <ul style={LIST_STYLE}>
              {snapshot.structure.value.wings.slice(0, 8).map(wing => (
                <li key={wing.wing}>{wing.wing}: {wing.drawerCount} {t('drawers')}</li>
              ))}
            </ul>
            <h5>{t('drawerSamples')}</h5>
            <ul style={LIST_STYLE}>
              {snapshot.structure.value.drawers.map(drawer => (
                <li key={drawer.id}><strong>{drawer.wing}/{drawer.room}</strong>: {drawer.preview}</li>
              ))}
            </ul>
            <h5>{t('tunnels')}</h5>
            {!snapshot.structure.value.tunnels.available ? <UnavailableNotice unavailable={snapshot.structure.value.tunnels} /> : (
              <ul style={LIST_STYLE}>
                {snapshot.structure.value.tunnels.value.slice(0, 8).map(tunnel => (
                  <li key={tunnel.id}>{tunnel.kind}: {tunnel.sourceWing}/{tunnel.sourceRoom} → {tunnel.targetWing}/{tunnel.targetRoom}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <section style={CARD_STYLE}>
        <h4>{t('knowledgeGraph')}</h4>
        {!snapshot.knowledgeGraph.available ? <UnavailableNotice unavailable={snapshot.knowledgeGraph} /> : (
          <div style={GRID_STYLE}>
            <p>{t('kgCounts', {
              entities: snapshot.knowledgeGraph.value.entities,
              facts: snapshot.knowledgeGraph.value.facts,
              current: snapshot.knowledgeGraph.value.currentFacts,
              expired: snapshot.knowledgeGraph.value.expiredFacts,
            })}</p>
            <ul style={LIST_STYLE}>
              {snapshot.knowledgeGraph.value.timeline.slice(0, 8).map(fact => (
                <li key={fact.id}>{fact.subject} {fact.predicate} {fact.object} ({fact.current ? t('current') : t('expired')})</li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section style={CARD_STYLE}>
        <h4>{t('health')}</h4>
        {!snapshot.health.available ? <UnavailableNotice unavailable={snapshot.health} /> : (
          <ul style={LIST_STYLE}>
            <li>{t('healthCounts', {
              drawers: snapshot.health.value.drawerCount,
              wings: snapshot.health.value.wingCount,
              rooms: snapshot.health.value.roomCount,
            })}</li>
            {snapshot.health.value.unavailableSignals.map(signal => <li key={signal.reason}>{signal.message}</li>)}
          </ul>
        )}
      </section>
      <section style={CARD_STYLE}>
        <h4>{t('retrievalTransparency')}</h4>
        {!snapshot.retrievalTransparency.available ? <UnavailableNotice unavailable={snapshot.retrievalTransparency} /> : null}
      </section>
    </div>
  )
}

function UnavailableNotice({ unavailable }: { readonly unavailable: MemPalaceUnavailable }): ReactNode {
  return <p role="status">{unavailable.message}</p>
}
