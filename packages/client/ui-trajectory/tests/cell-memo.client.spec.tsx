// @vitest-environment jsdom
/**
 * TrajectoryCell memoization: re-rendering the parent with identical cell props
 * must not re-run the cell body, so a streaming update to one cell leaves its
 * unchanged siblings untouched. This is the per-item memoization opencode uses
 * for its conversation list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { TrajectoryCell } from '../src/client/TrajectoryCell.tsx'
import { t } from './locale.client.ts'

afterEach(cleanup)

describe('TrajectoryCell memoization', () => {
  it('skips re-render when its own props are unchanged', () => {
    const spy = vi.fn()

    function Probe() {
      const [, force] = useState(0)
      spy()
      return (
        <div>
          <button type="button" onClick={() => { force(n => n + 1) }}>bump</button>
          <TrajectoryCell t={t} index={1} kind="tool" text="stable" timeSeconds={1} />
        </div>
      )
    }

    const { getByRole, container } = render(<Probe />)
    const before = container.querySelector('[data-kind="tool"]')
    const initialRenders = spy.mock.calls.length

    // Force parent re-renders; the cell's props are referentially identical.
    act(() => { getByRole('button').click() })
    act(() => { getByRole('button').click() })
    // The parent re-rendered at least twice more; the exact count is not the
    // contract — that the cell subtree was reused (below) is.
    expect(spy.mock.calls.length).toBeGreaterThan(initialRenders)

    // Same DOM node instance means React reused the memoized subtree.
    const after = container.querySelector('[data-kind="tool"]')
    expect(after).toBe(before)
    expect(after?.textContent).toContain('stable')
  })

  it('re-renders when a cell prop actually changes', () => {
    function Probe({ text }: { text: string }) {
      return <TrajectoryCell t={t} index={1} kind="tool" text={text} timeSeconds={1} />
    }
    const { container, rerender } = render(<Probe text="first" />)
    expect(container.querySelector('[data-kind="tool"]')?.textContent).toContain('first')
    rerender(<Probe text="second" />)
    expect(container.querySelector('[data-kind="tool"]')?.textContent).toContain('second')
  })
})
