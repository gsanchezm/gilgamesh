# Slice 42 — Voice in chat (STT dictate + TTS read-back)
#
# A new VoicePort (keystone §5 additive, no amendment) behind a deterministic offline stub
# (DeterministicVoice) selected by VOICE_MODE=offline or a missing provider key — the Brain slice
# pattern. Real STT/TTS lands via the Azure Speech adapter behind the same frozen port; CI never
# calls it (every harness pins VOICE_MODE=offline).
#
# @wip @ui like AC-AUTH-13 / slice 39: the BDD sweep does not exercise MediaRecorder or the network,
# so the EXECUTABLE proof lives in the application unit tests, the api Docker-free e2e
# (apps/api/test/voice.e2e.test.ts), and the web unit tests (ChatScreen). This feature documents
# intent + the acceptance criteria (AC-VOICE-01..05).

@wip @ui @voice
Feature: Voice in chat (speech-to-text dictate, text-to-speech read-back)
  As a member chatting with the pantheon
  I want to dictate a message and hear an agent reply read aloud
  So that I can use the chat hands-free, offline and reproducibly in CI

  @AC-VOICE-01
  Scenario: The offline stub transcribes deterministically
    Given VOICE_MODE=offline selects the DeterministicVoice stub
    When the same audio clip is transcribed twice
    Then both calls return the identical transcript
    And no network call, clock read, or randomness was involved

  @AC-VOICE-02
  Scenario: A dictated transcript lands in the composer without auto-sending
    Given I am in a chat conversation
    When I record a voice clip and it is transcribed
    Then the transcript appears in the message composer
    And nothing is sent until I press Send

  @AC-VOICE-03
  Scenario: The existing chat SSE streaming path is unchanged
    Given the live EventSource path (openLive/DELTA/MESSAGE/DONE/send/resync)
    When voice is added to the composer and per-message actions
    Then the SSE functions are byte-for-byte unchanged
    And the existing chat unit and e2e tests stay green

  @AC-VOICE-04
  Scenario: A non-member is not told the session exists
    Given a chat session in an organization I do not belong to
    When I POST to /chat/{sessionId}/transcribe or /chat/{sessionId}/speak
    Then I get 404 NOT_FOUND
    And the session's existence is never leaked as 403

  @AC-VOICE-05
  Scenario: An unconfigured provider falls back to the stub, never a 500
    Given no AZURE_SPEECH_KEY is set (or VOICE_MODE=offline)
    When voiceFromEnv resolves the VoicePort
    Then it returns the DeterministicVoice stub
    And a transcribe/speak request succeeds instead of 500-ing
