import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Retain the workspace's scroll extent during loads and workspace transitions. */
export function AnalyticsStage({
  children,
  transitionKey,
}: {
  children: ReactNode
  transitionKey: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (
      !content.current ||
      typeof content.current.animate !== 'function' ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    )
      return
    const chart = content.current.querySelector<HTMLElement>(
      ':scope > div:not([hidden]) .analytics-chart',
    )
    if (!chart) return
    const animation = chart.animate(
      [
        { transform: 'translateY(5px)', opacity: 0.75 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 180, easing: 'ease-out' },
    )
    return () => animation.cancel()
  }, [transitionKey])
  useLayoutEffect(() => {
    if (
      !frame.current ||
      !content.current ||
      typeof ResizeObserver === 'undefined'
    )
      return
    let width = 0
    let height = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!frame.current) return
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width
        height = 0
      }
      height = Math.max(height, entry.contentRect.height)
      frame.current.style.minHeight = `${height}px`
    })
    observer.observe(content.current)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={frame} className="analytics-stage">
      <div ref={content} className="analytics-sections">
        {children}
      </div>
    </div>
  )
}
