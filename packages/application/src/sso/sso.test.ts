import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, FakeTokenGenerator } from '../testing/fakes';
import { createInMemoryContext, type InMemoryContext } from '../testing/in-memory';
import { CompleteSsoLogin } from '../use-cases/sso-login';
import { RegisterUser } from '../use-cases/register-user';
import { parseSsoCallbackInput } from './callback-input';
import { InMemorySsoStateStore, SSO_STATE_TTL_MS } from './in-memory-sso-state-store';
import {
  STUB_SSO_CODE,
  STUB_SSO_PROFILE,
  STUB_SSO_UNVERIFIED_CODE,
  StubIdentityProvider,
} from './stub-identity-provider';

const ENTRY = { nonce: 'n-1', codeVerifier: 'v-1', redirect: 'https://app.test/cb' };

describe('InMemorySsoStateStore', () => {
  let clock: FakeClock;
  let store: InMemorySsoStateStore;

  beforeEach(() => {
    clock = new FakeClock();
    store = new InMemorySsoStateStore(clock);
  });

  it('returns a stored entry once — the second take is null (single use)', async () => {
    await store.put('s-1', ENTRY, SSO_STATE_TTL_MS);
    expect(await store.take('s-1')).toEqual(ENTRY);
    expect(await store.take('s-1')).toBeNull();
  });

  it('returns null for an unknown state', async () => {
    expect(await store.take('never-stored')).toBeNull();
  });

  it('expires entries after their TTL (and still consumes them)', async () => {
    await store.put('s-1', ENTRY, 1_000);
    clock.advance(999);
    await store.put('s-2', ENTRY, 1_000);
    expect(await store.take('s-1')).toEqual(ENTRY); // strictly before expiry → valid
    clock.advance(1_001);
    expect(await store.take('s-2')).toBeNull(); // past expiry → gone
  });

  it('caps the store: a /start flood evicts the OLDEST pending state', async () => {
    const capped = new InMemorySsoStateStore(clock, 2);
    await capped.put('s-1', ENTRY, SSO_STATE_TTL_MS);
    await capped.put('s-2', ENTRY, SSO_STATE_TTL_MS);
    await capped.put('s-3', ENTRY, SSO_STATE_TTL_MS);
    expect(await capped.take('s-1')).toBeNull(); // evicted
    expect(await capped.take('s-2')).toEqual(ENTRY);
    expect(await capped.take('s-3')).toEqual(ENTRY);
  });
});

describe('parseSsoCallbackInput', () => {
  it('accepts a {code, state} pair', () => {
    expect(parseSsoCallbackInput({ code: 'c', state: 's' })).toEqual({ code: 'c', state: 's' });
  });

  it.each([
    ['missing code', { state: 's' }],
    ['missing state', { code: 'c' }],
    ['non-string values', { code: 42, state: 's' }],
    ['not an object', 'code=c&state=s'],
    ['oversized state', { code: 'c', state: 'x'.repeat(513) }],
    ['oversized code', { code: 'x'.repeat(2049), state: 's' }],
  ])('rejects %s as VALIDATION', (_name, input) => {
    expect(() => parseSsoCallbackInput(input)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });
});

describe('StubIdentityProvider', () => {
  let ctx: InMemoryContext;
  let states: InMemorySsoStateStore;
  let stub: StubIdentityProvider;

  beforeEach(() => {
    ctx = createInMemoryContext();
    states = new InMemorySsoStateStore(ctx.clock as FakeClock);
    stub = new StubIdentityProvider({
      states,
      tokens: ctx.tokens as FakeTokenGenerator,
      completeSso: new CompleteSsoLogin(ctx),
    });
  });

  async function start(): Promise<string> {
    const { authUrl } = await stub.startLogin('https://app.test/cb');
    return new URL(authUrl).searchParams.get('state')!;
  }

  it('startLogin builds an authorize URL carrying state + nonce and stores the state server-side', async () => {
    const { authUrl } = await stub.startLogin('https://app.test/cb');
    const url = new URL(authUrl);
    const state = url.searchParams.get('state')!;
    expect(state).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
    const entry = await states.take(state);
    expect(entry).toMatchObject({ redirect: 'https://app.test/cb' });
  });

  it('completes login-or-register for the deterministic code (register path)', async () => {
    const state = await start();
    const res = await stub.completeLogin({ code: STUB_SSO_CODE, state });
    expect(res.isNewUser).toBe(true);
    expect(await ctx.users.findByEmail(STUB_SSO_PROFILE.email)).not.toBeNull();
  });

  it('logs in the existing stub-profile user on the second round-trip', async () => {
    const reg = await new RegisterUser(ctx).execute({
      firstName: 'Utu',
      lastName: 'Shamash',
      email: STUB_SSO_PROFILE.email,
      password: 'C0rrect-Horse!',
    });
    const state = await start();
    const res = await stub.completeLogin({ code: STUB_SSO_CODE, state });
    expect(res.isNewUser).toBe(false);
    expect(res.userId).toBe(reg.userId);
  });

  it('rejects an unknown state (VALIDATION)', async () => {
    await expect(stub.completeLogin({ code: STUB_SSO_CODE, state: 'forged' })).rejects.toMatchObject(
      { code: 'VALIDATION' },
    );
  });

  it('a state is single-use: the replay is rejected', async () => {
    const state = await start();
    await stub.completeLogin({ code: STUB_SSO_CODE, state });
    await expect(stub.completeLogin({ code: STUB_SSO_CODE, state })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects a wrong code (INVALID_CREDENTIALS) and still consumes the state', async () => {
    const state = await start();
    await expect(stub.completeLogin({ code: 'wrong', state })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(stub.completeLogin({ code: STUB_SSO_CODE, state })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('propagates the unverified-email rejection (FORBIDDEN) — no user is created', async () => {
    const state = await start();
    await expect(
      stub.completeLogin({ code: STUB_SSO_UNVERIFIED_CODE, state }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await ctx.users.findByEmail('sso.unverified@gilgamesh.test')).toBeNull();
  });
});
