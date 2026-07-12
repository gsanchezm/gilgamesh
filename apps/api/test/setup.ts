import 'reflect-metadata';

// Defense in depth (review S9): no test entrypoint may ever reach the network,
// even on a dev machine exporting ANTHROPIC_API_KEY.
process.env.BRAIN_MODE = process.env.BRAIN_MODE || 'offline';
// Same guard for payments (S13): the mock provider, never stripe.com.
process.env.PAYMENTS_MODE = process.env.PAYMENTS_MODE || 'offline';
// Slice 15: the deterministic StubIdentityProvider answers the SSO routes — an explicit opt-in,
// so a dev machine exporting GOOGLE_CLIENT_ID can never make this suite reach Google.
process.env.SSO_MODE = process.env.SSO_MODE || 'offline';
// Same for mail (S17): the recording stub, even when the machine env carries SMTP_URL.
process.env.EMAIL_MODE = process.env.EMAIL_MODE || 'offline';
// Slice 20: the in-memory secret-vault stub — an EXPLICIT opt-in (the selector refuses to boot
// unconfigured, never a silent stub); never Azure, even when the machine env carries
// AZURE_KEY_VAULT_URL.
process.env.VAULT_MODE = process.env.VAULT_MODE || 'offline';
// Slice 42: the DeterministicVoice stub — never Azure Speech, even when the machine env carries
// AZURE_SPEECH_KEY. Defense in depth alongside the vitest.config env pin.
process.env.VOICE_MODE = process.env.VOICE_MODE || 'offline';
