import { describe, expect, it } from "vitest";
import { parseMidi } from "../index";

describe("Variable Length Quantity (VLQ) Edge Cases", () => {
  const createMidiWithVLQ = (
    vlqBytes: number[],
    hasExtraData = false,
  ): Uint8Array => {
    const extraData = hasExtraData ? [0x40, 0x7f] : []; // Note data if needed
    const endTrackPadding = hasExtraData ? [] : [0x00, 0xff, 0x2f, 0x00];

    return new Uint8Array([
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
      vlqBytes.length +
        extraData.length +
        endTrackPadding.length +
        (hasExtraData ? 4 : 0), // Track length
      ...vlqBytes, // VLQ delta time
      ...(hasExtraData ? [0x90] : [0xff, 0x2f, 0x00]), // Event type or end of track
      ...extraData, // Event data
      ...endTrackPadding, // End of track if needed
    ]);
  };

  it("should parse minimum VLQ value (0)", () => {
    const data = createMidiWithVLQ([0x00]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(0);
  });

  it("should parse maximum single-byte VLQ (127)", () => {
    const data = createMidiWithVLQ([0x7f]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(127);
  });

  it("should parse minimum two-byte VLQ (128)", () => {
    const data = createMidiWithVLQ([0x81, 0x00]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(128);
  });

  it("should parse maximum two-byte VLQ (16383)", () => {
    const data = createMidiWithVLQ([0xff, 0x7f]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(16383);
  });

  it("should parse minimum three-byte VLQ (16384)", () => {
    const data = createMidiWithVLQ([0x81, 0x80, 0x00]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(16384);
  });

  it("should parse maximum three-byte VLQ (2097151)", () => {
    const data = createMidiWithVLQ([0xff, 0xff, 0x7f]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(2097151);
  });

  it("should parse minimum four-byte VLQ (2097152)", () => {
    const data = createMidiWithVLQ([0x81, 0x80, 0x80, 0x00]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(2097152);
  });

  it("should parse maximum four-byte VLQ (268435455)", () => {
    const data = createMidiWithVLQ([0xff, 0xff, 0xff, 0x7f]);
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(268435455);
  });

  it("should handle VLQ in meta event lengths", () => {
    const longTextData = new Array(200).fill(0x41); // 200 'A' characters
    const vlqLength = [0x81, 0x48]; // VLQ encoding of 200

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
      206 + vlqLength.length, // Track length: 1 (delta) + 1 (FF) + 1 (03) + vlqLength + 200 (text) + 4 (end track)
      0x00, // Delta time 0
      0xff,
      0x03, // Text meta event
      ...vlqLength, // VLQ length (200)
      ...longTextData, // Long text data
      0x00,
      0xff,
      0x2f,
      0x00, // End of track
    ]);

    const midi = parseMidi(data);
    const textEvent = midi.tracks[0].events[0];
    expect(textEvent.type).toBe("meta");
    if (textEvent.type === "meta") {
      expect(textEvent.data.length).toBe(200);
      expect(textEvent.text).toBe("A".repeat(200));
    }
  });

  it("should handle VLQ in SysEx event lengths", () => {
    const longSysExData = new Array(300).fill(0x43);
    const vlqLength = [0x82, 0x2c]; // VLQ encoding of 300

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
      305 + vlqLength.length, // Track length
      0x00, // Delta time 0
      0xf0, // SysEx event
      ...vlqLength, // VLQ length (300)
      ...longSysExData, // Long SysEx data
      0x00,
      0xff,
      0x2f,
      0x00, // End of track
    ]);

    const midi = parseMidi(data);
    const sysExEvent = midi.tracks[0].events[0];
    expect(sysExEvent.type).toBe("sysex");
    if (sysExEvent.type === "sysex") {
      expect(sysExEvent.data.length).toBe(300);
    }
  });

  it("should handle consecutive VLQ values correctly", () => {
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
      0x18,
      0x81,
      0x00, // VLQ: 128
      0x90,
      0x40,
      0x7f, // Note On
      0xff,
      0x7f, // VLQ: 16383
      0x80,
      0x40,
      0x40, // Note Off
      0x81,
      0x80,
      0x00, // VLQ: 16384
      0xff,
      0x2f,
      0x00, // End of track
    ]);

    const midi = parseMidi(data);
    expect(midi.tracks[0].events).toHaveLength(3);
    expect(midi.tracks[0].events[0].delta).toBe(128);
    expect(midi.tracks[0].events[1].delta).toBe(16383);
    expect(midi.tracks[0].events[2].delta).toBe(16384);
  });

  it("should handle VLQ values that could overflow if implemented incorrectly", () => {
    // Test a value that would overflow if using signed 32-bit arithmetic incorrectly
    const data = createMidiWithVLQ([0x87, 0xff, 0xff, 0x7f]); // Large value near 32-bit boundary
    const midi = parseMidi(data);
    // Calculate expected value: ((0x07 << 21) | (0x7F << 14) | (0x7F << 7) | 0x7F)
    const expected = (0x07 << 21) | (0x7f << 14) | (0x7f << 7) | 0x7f;
    expect(midi.tracks[0].events[0].delta).toBe(expected);
  });

  it("should correctly handle VLQ with leading zero bits", () => {
    // VLQ encoding can have redundant leading bytes
    const data = createMidiWithVLQ([0x80, 0x81, 0x00]); // Redundant encoding of 128
    const midi = parseMidi(data);
    expect(midi.tracks[0].events[0].delta).toBe(128);
  });

  it("should handle VLQ boundary cases in running status", () => {
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
      0x7f, // Note On: establish running status
      0xff,
      0x7f, // VLQ delta time: 16383
      0x44,
      0x60, // Running status Note On: note 68, velocity 96
      0x81,
      0x00, // VLQ delta time: 128
      0x40,
      0x00, // Running status Note On: note 64, velocity 0 (note off)
      0x00,
      0xff,
      0x2f,
      0x00, // End of track
    ]);

    const midi = parseMidi(data);
    expect(midi.tracks[0].events).toHaveLength(4);
    expect(midi.tracks[0].events[1].delta).toBe(16383);
    expect(midi.tracks[0].events[2].delta).toBe(128);
  });
});
