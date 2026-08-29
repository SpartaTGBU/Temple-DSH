import { describe, expect, it } from 'vitest'
import { DEFAULT_CACHE_RETENTION, resolveProfiles } from '../src/config.ts'

describe('prompt-cache retention default (caching on by default)', () => {
  it('defaults an unset route to short cache retention', () => {
    expect(DEFAULT_CACHE_RETENTION).toBe('short')
    const profile = resolveProfiles({ openai: {} }).get('openai')
    expect(profile?.cacheRetention).toBe('short')
  })

  it('honors an explicit cacheRetention over the default', () => {
    expect(resolveProfiles({ openai: { cacheRetention: 'long' } }).get('openai')?.cacheRetention).toBe('long')
    expect(resolveProfiles({ openai: { cacheRetention: 'short' } }).get('openai')?.cacheRetention).toBe('short')
  })

  it('allows explicit opt-out with none', () => {
    expect(resolveProfiles({ openai: { cacheRetention: 'none' } }).get('openai')?.cacheRetention).toBe('none')
  })

  it('resolves the default independently per route', () => {
    const profiles = resolveProfiles({
      openai: {},
      anthropic: { cacheRetention: 'none' },
    })
    expect(profiles.get('openai')?.cacheRetention).toBe('short')
    expect(profiles.get('anthropic')?.cacheRetention).toBe('none')
  })
})
