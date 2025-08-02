/**
 * Test utilities for MIDI parser tests
 */

/**
 * Creates a minimal valid MIDI file with specified parameters
 */
export function createTestMidi(options: {
  format?: 0 | 1 | 2;
  tracks?: number;
  division?: number;
  events?: Array<{ track: number; events: number[] }>;
}): Uint8Array {
  const { format = 0, tracks = 1, division = 480, events = [] } = options;

  // Create header
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // "MThd"
    0x00,
    0x00,
    0x00,
    0x06, // Header length
    0x00,
    format, // Format
    (tracks >> 8) & 0xff,
    tracks & 0xff, // Number of tracks
    (division >> 8) & 0xff,
    division & 0xff, // Division
  ];

  const trackData: number[] = [];

  // Create tracks
  for (let trackIndex = 0; trackIndex < tracks; trackIndex++) {
    const trackEvents =
      events.find((e) => e.track === trackIndex)?.events || [];

    // Default to just end of track if no events specified
    const defaultEvents = [0x00, 0xff, 0x2f, 0x00]; // Delta 0, End of Track
    const finalEvents = trackEvents.length > 0 ? trackEvents : defaultEvents;

    // Ensure track ends with End of Track
    const hasEndOfTrack =
      finalEvents.length >= 4 &&
      finalEvents[finalEvents.length - 4] === 0xff &&
      finalEvents[finalEvents.length - 3] === 0x2f;

    if (!hasEndOfTrack) {
      finalEvents.push(0x00, 0xff, 0x2f, 0x00);
    }

    trackData.push(
      0x4d,
      0x54,
      0x72,
      0x6b, // "MTrk"
      (finalEvents.length >> 24) & 0xff,
      (finalEvents.length >> 16) & 0xff,
      (finalEvents.length >> 8) & 0xff,
      finalEvents.length & 0xff,
      ...finalEvents,
    );
  }

  return new Uint8Array([...header, ...trackData]);
}

/**
 * Creates a MIDI file with specific channel events for testing
 */
export function createTestMidiWithNotes(
  notes: Array<{
    delta?: number;
    channel?: number;
    note: number;
    velocity: number;
    duration?: number; // If specified, adds note off after duration
  }>,
): Uint8Array {
  const events: number[] = [];

  for (const noteSpec of notes) {
    const { delta = 0, channel = 0, note, velocity, duration } = noteSpec;

    // Add delta time as VLQ (simplified for small values)
    if (delta < 128) {
      events.push(delta);
    } else {
      // For larger deltas, would need proper VLQ encoding
      events.push(0x81, delta - 128);
    }

    // Add Note On event
    events.push(0x90 | channel, note, velocity);

    // Add Note Off if duration specified
    if (duration !== undefined) {
      if (duration < 128) {
        events.push(duration);
      } else {
        events.push(0x81, duration - 128);
      }
      events.push(0x80 | channel, note, 64); // Note off with velocity 64
    }
  }

  return createTestMidi({
    events: [{ track: 0, events }],
  });
}

/**
 * Creates a MIDI file with meta events for testing
 */
export function createTestMidiWithMeta(
  metaEvents: Array<{
    delta?: number;
    metaType: number;
    data: number[];
  }>,
): Uint8Array {
  const events: number[] = [];

  for (const meta of metaEvents) {
    const { delta = 0, metaType, data } = meta;

    // Add delta time
    events.push(delta);

    // Add meta event
    events.push(0xff, metaType);

    // Add length (simplified VLQ for small values)
    if (data.length < 128) {
      events.push(data.length);
    } else {
      events.push(0x81, data.length - 128);
    }

    // Add data
    events.push(...data);
  }

  return createTestMidi({
    events: [{ track: 0, events }],
  });
}

/**
 * Encodes a number as Variable Length Quantity (VLQ)
 */
export function encodeVLQ(value: number): number[] {
  if (value === 0) return [0];

  const bytes: number[] = [];
  let remaining = value;

  // Extract 7-bit chunks from right to left
  while (remaining > 0) {
    bytes.unshift(remaining & 0x7f);
    remaining >>= 7;
  }

  // Set continuation bit on all bytes except the last
  for (let i = 0; i < bytes.length - 1; i++) {
    bytes[i] |= 0x80;
  }

  return bytes;
}

/**
 * Creates a tempo change meta event data
 */
export function createTempoEvent(microsecondsPerQuarter: number): number[] {
  return [
    (microsecondsPerQuarter >> 16) & 0xff,
    (microsecondsPerQuarter >> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ];
}

/**
 * Creates a time signature meta event data
 */
export function createTimeSignatureEvent(
  numerator: number,
  denominatorPower: number, // 2^denominatorPower = actual denominator
  metronome: number = 24,
  thirtySeconds: number = 8,
): number[] {
  return [numerator, denominatorPower, metronome, thirtySeconds];
}

/**
 * Creates a key signature meta event data
 */
export function createKeySignatureEvent(
  sharpsFlats: number, // Positive for sharps, negative for flats
  minor: boolean = false,
): number[] {
  const sf = sharpsFlats < 0 ? 256 + sharpsFlats : sharpsFlats;
  return [sf, minor ? 1 : 0];
}

/**
 * Validates that a parsed MIDI file has the expected structure
 */
export function validateMidiStructure(
  midi: any,
  expectedFormat: number,
  expectedTrackCount: number,
): void {
  expect(midi).toBeDefined();
  expect(midi.format).toBe(expectedFormat);
  expect(midi.tracks).toHaveLength(expectedTrackCount);

  // Each track should have at least one event (End of Track)
  for (let i = 0; i < midi.tracks.length; i++) {
    expect(midi.tracks[i].events.length).toBeGreaterThan(0);

    // Last event should be End of Track
    const lastEvent = midi.tracks[i].events[midi.tracks[i].events.length - 1];
    expect(lastEvent.type).toBe("meta");
    expect(lastEvent.metaType).toBe(0x2f);
  }
}

/**
 * Extracts all note events from a parsed MIDI file
 */
export function extractNoteEvents(midi: any): Array<{
  track: number;
  absoluteTick: number;
  type: "noteOn" | "noteOff";
  channel: number;
  note: number;
  velocity: number;
}> {
  const noteEvents: any[] = [];

  for (let trackIndex = 0; trackIndex < midi.tracks.length; trackIndex++) {
    let absoluteTick = 0;

    for (const event of midi.tracks[trackIndex].events) {
      absoluteTick += event.delta;

      if (
        event.type === "channel" &&
        (event.subtype === "noteOn" || event.subtype === "noteOff")
      ) {
        noteEvents.push({
          track: trackIndex,
          absoluteTick,
          type: event.subtype,
          channel: event.channel,
          note: event.note,
          velocity: event.velocity,
        });
      }
    }
  }

  return noteEvents;
}

/**
 * Creates a large MIDI file for performance testing
 */
export function createLargeMidiFile(
  trackCount: number,
  eventsPerTrack: number,
): Uint8Array {
  const tracks: Array<{ track: number; events: number[] }> = [];

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex++) {
    const events: number[] = [];

    for (let eventIndex = 0; eventIndex < eventsPerTrack; eventIndex++) {
      // Add a simple note on event with varying delta times
      const delta = eventIndex % 10;
      events.push(delta, 0x90, 60 + (eventIndex % 12), 64);
    }

    tracks.push({ track: trackIndex, events });
  }

  return createTestMidi({
    format: 1,
    tracks: trackCount,
    events: tracks,
  });
}
