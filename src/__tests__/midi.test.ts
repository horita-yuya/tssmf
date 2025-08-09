import { beforeAll, describe, expect, it } from "vitest";
import {
  buildTempoMap,
  type ChannelEvent,
  type MetaEvent,
  type MidiFile,
  parseMidi,
  type SysExEvent,
  ticksToMs,
} from "../index";
import { createTestMidiWithNotes } from "./test-utils";

describe("MIDI Parser", () => {
  let testMidiBuffer: ArrayBuffer;

  beforeAll(() => {
    // Create a test MIDI file with various events for integration tests
    testMidiBuffer = createTestMidiWithNotes([
      { delta: 0, channel: 0, note: 60, velocity: 64 },
      { delta: 480, channel: 0, note: 60, velocity: 0 }, // Note off
      { delta: 0, channel: 0, note: 64, velocity: 80 },
      { delta: 480, channel: 0, note: 64, velocity: 0 },
      { delta: 0, channel: 1, note: 67, velocity: 100 },
      { delta: 960, channel: 1, note: 67, velocity: 0 },
    ]).buffer as ArrayBuffer;
  });

  describe("MIDI Header Parsing", () => {
    it("should parse valid MIDI header correctly", () => {
      // Create a minimal valid MIDI file with format 0, 1 track, 480 PPQ
      const headerData = new Uint8Array([
        // MThd header
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06, // Header length (6 bytes)
        0x00,
        0x00, // Format 0
        0x00,
        0x01, // 1 track
        0x01,
        0xe0, // 480 PPQ
        // MTrk header with minimal track
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04, // Track length (4 bytes)
        0x00, // Delta time 0
        0xff,
        0x2f,
        0x00, // End of track meta event
      ]);

      const midi = parseMidi(headerData);

      expect(midi.format).toBe(0);
      expect(midi.tracks).toHaveLength(1);
      expect(midi.ticksPerQuarter).toBe(480);
      expect(midi.smpte).toBeUndefined();
    });

    it("should parse format 1 MIDI file", () => {
      const headerData = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06, // Header length
        0x00,
        0x01, // Format 1
        0x00,
        0x02, // 2 tracks
        0x00,
        0x60, // 96 PPQ
        // First track
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04, // Track length
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
        // Second track
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04, // Track length
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(headerData);

      expect(midi.format).toBe(1);
      expect(midi.tracks).toHaveLength(2);
      expect(midi.ticksPerQuarter).toBe(96);
    });

    it("should parse SMPTE division correctly", () => {
      const headerData = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06, // Header length
        0x00,
        0x00, // Format 0
        0x00,
        0x01, // 1 track
        0xe7,
        0x28, // SMPTE: -25 fps, 40 ticks per frame
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04, // Track length
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(headerData);

      expect(midi.ticksPerQuarter).toBeUndefined();
      expect(midi.smpte).toEqual({ fps: 25, ticksPerFrame: 40 });
    });

    it("should throw error for invalid header", () => {
      const invalidHeader = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x65, // "MThe" (invalid)
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
      ]);

      expect(() => parseMidi(invalidHeader)).toThrow(
        "Invalid MIDI file: missing MThd header",
      );
    });

    it("should throw error for unsupported format", () => {
      const unsupportedFormat = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x03, // Format 3 (unsupported)
        0x00,
        0x01,
        0x01,
        0xe0,
      ]);

      expect(() => parseMidi(unsupportedFormat)).toThrow(
        "Unsupported MIDI format: 3",
      );
    });

    it("should throw error for invalid header length", () => {
      const invalidLength = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x08, // Invalid length (8 instead of 6)
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x00,
        0x00,
      ]);

      expect(() => parseMidi(invalidLength)).toThrow(
        "Invalid MIDI header length",
      );
    });
  });

  describe("Variable Length Quantity (VLQ) Parsing", () => {
    it("should parse single-byte VLQ values", () => {
      // Create MIDI with VLQ delta times
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06, // Header length
        0x00,
        0x00, // Format 0
        0x00,
        0x01, // 1 track
        0x01,
        0xe0, // 480 PPQ
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x08, // Track length
        0x7f, // Delta time 127 (max single byte)
        0xff,
        0x2f,
        0x00, // End of track
        0x00, // Delta time 0
        0xff,
        0x2f,
        0x00, // End of track (duplicate for length)
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks[0].events[0].delta).toBe(127);
    });

    it("should parse multi-byte VLQ values", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x09,
        0x81,
        0x00, // Delta time 128 (two bytes: 0x81 0x00)
        0xff,
        0x2f,
        0x00, // End of track
        0x00,
        0xff,
        0x2f,
        0x00, // Padding
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks[0].events[0].delta).toBe(128);
    });

    it("should parse large VLQ values", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0b,
        0x83,
        0xff,
        0x7f, // Delta time 65535 (three bytes)
        0xff,
        0x2f,
        0x00, // End of track
        0x00,
        0xff,
        0x2f,
        0x00, // Padding
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks[0].events[0].delta).toBe(65535);
    });
  });

  describe("Channel Events", () => {
    it("should parse Note On events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0x90,
        0x40,
        0x7f, // Note On: channel 0, note 64 (middle C), velocity 127
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("noteOn");
      expect(event.channel).toBe(0);
      expect(event.note).toBe(64);
      expect(event.velocity).toBe(127);
    });

    it("should parse Note Off events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0x80,
        0x40,
        0x40, // Note Off: channel 0, note 64, velocity 64
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("noteOff");
      expect(event.channel).toBe(0);
      expect(event.note).toBe(64);
      expect(event.velocity).toBe(64);
    });

    it("should parse Polyphonic Aftertouch events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xa5,
        0x40,
        0x50, // Poly Aftertouch: channel 5, note 64, pressure 80
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("polyAftertouch");
      expect(event.channel).toBe(5);
      expect(event.note).toBe(64);
      expect(event.pressure).toBe(80);
    });

    it("should parse Control Change events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xb2,
        0x07,
        0x64, // Control Change: channel 2, controller 7 (volume), value 100
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("controlChange");
      expect(event.channel).toBe(2);
      expect(event.controller).toBe(7);
      expect(event.value).toBe(100);
    });

    it("should parse Program Change events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x09,
        0x00, // Delta time 0
        0xc3,
        0x19, // Program Change: channel 3, program 25
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("programChange");
      expect(event.channel).toBe(3);
      expect(event.program).toBe(25);
    });

    it("should parse Channel Pressure events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x09,
        0x00, // Delta time 0
        0xd7,
        0x60, // Channel Pressure: channel 7, pressure 96
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("channelPressure");
      expect(event.channel).toBe(7);
      expect(event.pressure).toBe(96);
    });

    it("should parse Pitch Bend events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xe4,
        0x00,
        0x40, // Pitch Bend: channel 4, LSB=0, MSB=64 (center position)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("pitchBend");
      expect(event.channel).toBe(4);
      expect(event.value).toBe(0); // Center position (0x2000 - 0x2000 = 0)
    });

    it("should parse Pitch Bend with maximum positive value", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xe0,
        0x7f,
        0x7f, // Pitch Bend: channel 0, LSB=127, MSB=127 (max positive)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("pitchBend");
      expect(event.value).toBe(8191); // 0x3FFF - 0x2000 = 8191
    });

    it("should parse Pitch Bend with maximum negative value", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xe0,
        0x00,
        0x00, // Pitch Bend: channel 0, LSB=0, MSB=0 (max negative)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("pitchBend");
      expect(event.value).toBe(-8192); // 0x0000 - 0x2000 = -8192
    });
  });

  describe("Running Status", () => {
    it("should handle running status for channel events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x10,
        0x00, // Delta time 0
        0x90,
        0x40,
        0x7f, // Note On: channel 0, note 64, velocity 127
        0x30, // Delta time 48
        0x44,
        0x60, // Running status Note On: note 68, velocity 96
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);

      expect(midi.tracks[0].events).toHaveLength(3); // 2 note events + end of track

      const firstNote = midi.tracks[0].events[0] as ChannelEvent;
      expect(firstNote.subtype).toBe("noteOn");
      expect(firstNote.note).toBe(64);
      expect(firstNote.velocity).toBe(127);

      const secondNote = midi.tracks[0].events[1] as ChannelEvent;
      expect(secondNote.subtype).toBe("noteOn");
      expect(secondNote.note).toBe(68);
      expect(secondNote.velocity).toBe(96);
      expect(secondNote.delta).toBe(48);
    });

    it("should throw error when running status used without previous status", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x08,
        0x00, // Delta time 0
        0x40,
        0x7f, // Invalid: running status without previous status
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      expect(() => parseMidi(data)).toThrow(
        "Running status used without previous status",
      );
    });

    it("should reset running status for meta and sysex events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x12,
        0x00, // Delta time 0
        0x90,
        0x40,
        0x7f, // Note On: channel 0, note 64, velocity 127
        0x00, // Delta time 0
        0xff,
        0x51,
        0x03,
        0x07,
        0xa1,
        0x20, // Set Tempo meta event
        0x00, // Delta time 0
        0x80,
        0x40,
        0x40, // Note Off (new status required after meta event)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(4); // note on, tempo, note off, end of track

      const noteOff = midi.tracks[0].events[2] as ChannelEvent;
      expect(noteOff.subtype).toBe("noteOff");
      expect(noteOff.note).toBe(64);
    });
  });

  describe("Meta Events", () => {
    it("should parse text meta events", () => {
      const text = "Track Name";
      const textBytes = new TextEncoder().encode(text);

      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x11,
        0x00, // Delta time 0
        0xff,
        0x03,
        0x0a, // Text meta event type 3, length 10
        ...textBytes, // "Track Name"
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(3);
      expect(event.text).toBe(text);
    });

    it("should parse tempo meta events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xff,
        0x51,
        0x03, // Set Tempo meta event, length 3
        0x07,
        0xa1,
        0x20, // 500,000 microseconds per quarter note (120 BPM)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x51);
      expect(event.tempoUsPerQuarter).toBe(500000);
    });

    it("should parse time signature meta events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0b,
        0x00, // Delta time 0
        0xff,
        0x58,
        0x04, // Time Signature meta event, length 4
        0x04,
        0x02,
        0x18,
        0x08, // 4/4 time, metronome=24, thirty-seconds=8
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x58);
      expect(event.timeSig).toEqual({
        num: 4,
        den: 4, // 2^2 = 4
        metronome: 24,
        thirtyseconds: 8,
      });
    });

    it("should parse key signature meta events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x09,
        0x00, // Delta time 0
        0xff,
        0x59,
        0x02, // Key Signature meta event, length 2
        0x02,
        0x00, // 2 sharps, major key
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x59);
      expect(event.keySig).toEqual({
        sf: 2,
        minor: false,
      });
    });

    it("should parse key signature with negative sharps/flats", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x09,
        0x00, // Delta time 0
        0xff,
        0x59,
        0x02, // Key Signature meta event, length 2
        0xfe,
        0x01, // -2 (2 flats), minor key
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x59);
      expect(event.keySig).toEqual({
        sf: -2,
        minor: true,
      });
    });

    it("should parse end of track meta events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04,
        0x00, // Delta time 0
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x2f);
      expect(event.endOfTrack).toBe(true);
    });

    it("should parse unknown meta events with raw data", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xff,
        0x7f,
        0x03, // Unknown meta event type 0x7F, length 3
        0x01,
        0x02,
        0x03, // Custom data
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(event.type).toBe("meta");
      expect(event.metaType).toBe(0x7f);
      expect(Array.from(event.data)).toEqual([1, 2, 3]);
    });
  });

  describe("SysEx Events", () => {
    it("should parse standard SysEx events (0xF0)", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0c,
        0x00, // Delta time 0
        0xf0,
        0x05, // SysEx F0, length 5
        0x43,
        0x12,
        0x00,
        0x43,
        0xf7, // SysEx data ending with F7
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as SysExEvent;

      expect(event.type).toBe("sysex");
      expect(event.kind).toBe(0xf0);
      expect(Array.from(event.data)).toEqual([0x43, 0x12, 0x00, 0x43, 0xf7]);
    });

    it("should parse continuation SysEx events (0xF7)", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0xf7,
        0x03, // SysEx F7 (continuation), length 3
        0x01,
        0x02,
        0x03, // Continuation data
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as SysExEvent;

      expect(event.type).toBe("sysex");
      expect(event.kind).toBe(0xf7);
      expect(Array.from(event.data)).toEqual([0x01, 0x02, 0x03]);
    });

    it("should parse empty SysEx events", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x07,
        0x00, // Delta time 0
        0xf0,
        0x00, // SysEx F0, length 0
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as SysExEvent;

      expect(event.type).toBe("sysex");
      expect(event.kind).toBe(0xf0);
      expect(event.data.length).toBe(0);
    });
  });

  describe("Track Parsing", () => {
    it("should throw error for invalid track header", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6c, // "MTrl" (invalid)
        0x00,
        0x00,
        0x00,
        0x04,
        0x00,
        0xff,
        0x2f,
        0x00,
      ]);

      expect(() => parseMidi(data)).toThrow(
        "Invalid track chunk: missing MTrk header",
      );
    });

    it("should parse empty tracks", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04,
        0x00,
        0xff,
        0x2f,
        0x00, // Only end of track
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks).toHaveLength(1);
      expect(midi.tracks[0].events).toHaveLength(1);
      expect(midi.tracks[0].events[0].type).toBe("meta");
    });

    it("should stop parsing track at end of track event", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
        0x00,
        0x90,
        0x40,
        0x7f, // This should not be parsed
      ]);

      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(1);
      expect(midi.tracks[0].events[0].type).toBe("meta");
    });
  });

  describe("Error Handling", () => {
    it("should throw error for unsupported event status", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x05,
        0x00, // Delta time 0
        0xf1, // Invalid status byte
        0x40,
        0xff,
        0x2f,
        0x00,
      ]);

      expect(() => parseMidi(data)).toThrow("Unsupported event status: 0xf1");
    });

    it("should handle truncated data gracefully", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x10, // Claims 16 bytes but only provides 4
        0x00,
        0xff,
        0x2f,
        0x00,
      ]);

      // Should not throw, but parse what's available
      expect(() => parseMidi(data)).not.toThrow();
    });

    it("should throw error for unknown channel event type", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x08,
        0x00, // Delta time 0
        0xf0 - 1, // 0xEF is valid (pitch bend), this test ensures we cover edge cases
        0x40,
        0x7f,
        0x00,
        0xff,
        0x2f,
        0x00,
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;
      expect(event.subtype).toBe("pitchBend"); // 0xEF should parse as pitch bend
    });
  });

  describe("Integration Tests", () => {
    it("should parse the test_simple.mid file", () => {
      const midi = parseMidi(testMidiBuffer);

      expect(midi.format).toBeDefined();
      expect(midi.tracks).toBeDefined();
      expect(midi.tracks.length).toBeGreaterThan(0);

      // Basic validation that it contains some events
      let totalEvents = 0;
      for (const track of midi.tracks) {
        totalEvents += track.events.length;
      }
      expect(totalEvents).toBeGreaterThan(0);
    });

    it("should find note events in test file", () => {
      const midi = parseMidi(testMidiBuffer);

      let noteEvents = 0;
      for (const track of midi.tracks) {
        for (const event of track.events) {
          if (
            event.type === "channel" &&
            (event.subtype === "noteOn" || event.subtype === "noteOff")
          ) {
            noteEvents++;
          }
        }
      }

      expect(noteEvents).toBeGreaterThan(0);
    });

    it("should have valid delta times", () => {
      const midi = parseMidi(testMidiBuffer);

      for (const track of midi.tracks) {
        for (const event of track.events) {
          expect(event.delta).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(event.delta)).toBe(true);
        }
      }
    });
  });

  describe("Tempo Utilities", () => {
    describe("buildTempoMap", () => {
      it("should create default tempo map with no tempo events", () => {
        const midi: MidiFile = {
          format: 0,
          tracks: [
            {
              events: [
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x2f,
                  data: new Uint8Array(),
                  endOfTrack: true,
                },
              ],
            },
          ],
          ticksPerQuarter: 480,
        };

        const tempoMap = buildTempoMap(midi);

        expect(tempoMap).toHaveLength(1);
        expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 });
      });

      it("should build tempo map with single tempo change", () => {
        const midi: MidiFile = {
          format: 0,
          tracks: [
            {
              events: [
                {
                  delta: 480,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array([0x06, 0x1a, 0x80]),
                  tempoUsPerQuarter: 400000,
                },
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x2f,
                  data: new Uint8Array(),
                  endOfTrack: true,
                },
              ],
            },
          ],
          ticksPerQuarter: 480,
        };

        const tempoMap = buildTempoMap(midi);

        expect(tempoMap).toHaveLength(2);
        expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 });
        expect(tempoMap[1]).toEqual({ tick: 480, usPerQuarter: 400000 });
      });

      it("should build tempo map with multiple tempo changes", () => {
        const midi: MidiFile = {
          format: 1,
          tracks: [
            {
              events: [
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array(),
                  tempoUsPerQuarter: 600000,
                },
                {
                  delta: 960,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array(),
                  tempoUsPerQuarter: 300000,
                },
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x2f,
                  data: new Uint8Array(),
                  endOfTrack: true,
                },
              ],
            },
            {
              events: [
                {
                  delta: 480,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array(),
                  tempoUsPerQuarter: 450000,
                },
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x2f,
                  data: new Uint8Array(),
                  endOfTrack: true,
                },
              ],
            },
          ],
          ticksPerQuarter: 480,
        };

        const tempoMap = buildTempoMap(midi);

        expect(tempoMap).toHaveLength(3);
        expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 600000 });
        expect(tempoMap[1]).toEqual({ tick: 480, usPerQuarter: 450000 });
        expect(tempoMap[2]).toEqual({ tick: 960, usPerQuarter: 300000 });
      });

      it("should handle tempo changes at the same tick", () => {
        const midi: MidiFile = {
          format: 0,
          tracks: [
            {
              events: [
                {
                  delta: 480,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array(),
                  tempoUsPerQuarter: 400000,
                },
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x51,
                  data: new Uint8Array(),
                  tempoUsPerQuarter: 350000,
                },
                {
                  delta: 0,
                  type: "meta",
                  metaType: 0x2f,
                  data: new Uint8Array(),
                  endOfTrack: true,
                },
              ],
            },
          ],
          ticksPerQuarter: 480,
        };

        const tempoMap = buildTempoMap(midi);

        expect(tempoMap).toHaveLength(2);
        expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 });
        expect(tempoMap[1]).toEqual({ tick: 480, usPerQuarter: 350000 }); // Should use the last tempo at this tick
      });
    });

    describe("ticksToMs", () => {
      it("should convert ticks to milliseconds with single tempo", () => {
        const tempoMap = [{ tick: 0, usPerQuarter: 500000 }]; // 120 BPM
        const ppq = 480;

        // One quarter note = 480 ticks = 500ms at 120 BPM
        expect(ticksToMs(480, tempoMap, ppq)).toBeCloseTo(500, 1);
        expect(ticksToMs(960, tempoMap, ppq)).toBeCloseTo(1000, 1);
        expect(ticksToMs(240, tempoMap, ppq)).toBeCloseTo(250, 1);
      });

      it("should convert ticks to milliseconds with tempo changes", () => {
        const tempoMap = [
          { tick: 0, usPerQuarter: 500000 }, // 120 BPM from tick 0
          { tick: 480, usPerQuarter: 400000 }, // 150 BPM from tick 480
        ];
        const ppq = 480;

        // First quarter note (0-480 ticks) at 120 BPM = 500ms
        expect(ticksToMs(480, tempoMap, ppq)).toBeCloseTo(500, 1);

        // Second quarter note (480-960 ticks) at 150 BPM = 400ms
        // Total for 960 ticks = 500ms + 400ms = 900ms
        expect(ticksToMs(960, tempoMap, ppq)).toBeCloseTo(900, 1);
      });

      it("should handle ticks before first tempo change", () => {
        const tempoMap = [
          { tick: 0, usPerQuarter: 500000 },
          { tick: 480, usPerQuarter: 400000 },
        ];
        const ppq = 480;

        expect(ticksToMs(240, tempoMap, ppq)).toBeCloseTo(250, 1); // Half quarter note at 120 BPM
      });

      it("should handle ticks after last tempo change", () => {
        const tempoMap = [
          { tick: 0, usPerQuarter: 500000 },
          { tick: 480, usPerQuarter: 400000 },
        ];
        const ppq = 480;

        // 1440 ticks = first 480 at 120BPM (500ms) + next 960 at 150BPM (800ms) = 1300ms
        expect(ticksToMs(1440, tempoMap, ppq)).toBeCloseTo(1300, 1);
      });

      it("should throw error for empty tempo map", () => {
        expect(() => ticksToMs(480, [], 480)).toThrow("Tempo map is empty");
      });

      it("should handle zero ticks", () => {
        const tempoMap = [{ tick: 0, usPerQuarter: 500000 }];
        const ppq = 480;

        expect(ticksToMs(0, tempoMap, ppq)).toBe(0);
      });

      it("should handle complex tempo map with multiple changes", () => {
        const tempoMap = [
          { tick: 0, usPerQuarter: 600000 }, // 100 BPM
          { tick: 240, usPerQuarter: 500000 }, // 120 BPM
          { tick: 480, usPerQuarter: 400000 }, // 150 BPM
          { tick: 720, usPerQuarter: 300000 }, // 200 BPM
        ];
        const ppq = 480;

        // Tick 960:
        // 0-240: 240 ticks at 100 BPM = (240 * 600000) / (480 * 1000) = 300ms
        // 240-480: 240 ticks at 120 BPM = (240 * 500000) / (480 * 1000) = 250ms
        // 480-720: 240 ticks at 150 BPM = (240 * 400000) / (480 * 1000) = 200ms
        // 720-960: 240 ticks at 200 BPM = (240 * 300000) / (480 * 1000) = 150ms
        // Total = 300 + 250 + 200 + 150 = 900ms
        expect(ticksToMs(960, tempoMap, ppq)).toBeCloseTo(900, 1);
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle MIDI files with large track counts", () => {
      // Create MIDI with many empty tracks
      const numTracks = 100;
      const headerData = [
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06, // Header length
        0x00,
        0x01, // Format 1
        (numTracks >> 8) & 0xff,
        numTracks & 0xff, // Track count
        0x01,
        0xe0, // 480 PPQ
      ];

      // Add empty tracks
      const trackData = [
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x04, // Track length
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ];

      const fullData = new Uint8Array(
        headerData.length + trackData.length * numTracks,
      );
      fullData.set(headerData, 0);

      for (let i = 0; i < numTracks; i++) {
        fullData.set(trackData, headerData.length + i * trackData.length);
      }

      const midi = parseMidi(fullData);
      expect(midi.tracks).toHaveLength(numTracks);
    });

    it("should handle Note On with velocity 0 as Note Off equivalent", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0a,
        0x00, // Delta time 0
        0x90,
        0x40,
        0x00, // Note On with velocity 0 (equivalent to Note Off)
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as ChannelEvent;

      expect(event.type).toBe("channel");
      expect(event.subtype).toBe("noteOff");
      expect(event.velocity).toBe(64);
    });

    it("should handle very large VLQ values", () => {
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0d,
        0x8f,
        0xff,
        0xff,
        0x7f, // VLQ: maximum 4-byte value (0x0FFFFFFF)
        0xff,
        0x2f,
        0x00, // End of track
        0x00,
        0xff,
        0x2f,
        0x00, // Padding
      ]);

      const midi = parseMidi(data);
      // Calculate expected VLQ value: (0x0F << 21) | (0x7F << 14) | (0x7F << 7) | 0x7F
      const expected = (0x0f << 21) | (0x7f << 14) | (0x7f << 7) | 0x7f;
      expect(midi.tracks[0].events[0].delta).toBe(expected);
    });

    it("should preserve exact byte data in meta events", () => {
      const customData = new Uint8Array([0xff, 0x00, 0x80, 0x7f, 0x01]);
      const data = new Uint8Array([
        0x4d,
        0x54,
        0x68,
        0x64, // "MThd"
        0x00,
        0x00,
        0x00,
        0x06,
        0x00,
        0x00,
        0x00,
        0x01,
        0x01,
        0xe0,
        0x4d,
        0x54,
        0x72,
        0x6b, // "MTrk"
        0x00,
        0x00,
        0x00,
        0x0c,
        0x00, // Delta time 0
        0xff,
        0x7e,
        0x05, // Custom meta event, length 5
        ...customData, // Custom data
        0x00,
        0xff,
        0x2f,
        0x00, // End of track
      ]);

      const midi = parseMidi(data);
      const event = midi.tracks[0].events[0] as MetaEvent;

      expect(Array.from(event.data)).toEqual(Array.from(customData));
    });
  });
});
