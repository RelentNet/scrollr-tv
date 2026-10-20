import { useId, useRef } from 'react'
import type { ReactNode } from 'react'

/** Native modal keeps focus, Escape and the background's scroll position intact. */
export function AnalyticsDetails({
  children,
  title = 'Explore this report',
  compact = false,
}: {
  children: ReactNode
  title?: string
  compact?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  return (
    <>
      <button
        type="button"
        className={compact ? 'analytics-info' : 'analytics-explore'}
        aria-label={compact ? title : undefined}
        title={compact ? title : undefined}
        onClick={() => dialog.current?.showModal()}
      >
        {compact ? (
          <span aria-hidden>i</span>
        ) : (
          <>
            {title} <span aria-hidden>↗</span>
          </>
        )}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="analytics-drawer"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close()
        }}
      >
        <div className="analytics-drawer-surface">
          <header>
            <h2 id={titleId}>{title}</h2>
            <button type="button" onClick={() => dialog.current?.close()}>
              Close <span aria-hidden>×</span>
            </button>
          </header>
          <div className="analytics-detail-content">{children}</div>
        </div>
      </dialog>
    </>
  )
}
