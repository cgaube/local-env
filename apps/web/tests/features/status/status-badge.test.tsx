import { render, screen } from '@testing-library/react'
import { StatusBadge } from '#ui/features/status/status-badge'
import { tone } from '#ui/features/status/tone.ts'

describe('tone', () => {
  test.each([
    ['running', 'ok'],
    ['healthy', 'ok'],
    ['starting', 'warn'],
    ['restarting', 'warn'],
    ['exited', 'bad'],
    ['unhealthy', 'bad'],
  ])('%p is %p', (state, expected) => {
    expect(tone(state)).toBe(expected)
  })
})

describe('StatusBadge', () => {
  test('shows the state', () => {
    render(<StatusBadge state="exited" />)

    expect(screen.getByText('exited')).toBeInTheDocument()
  })
})
