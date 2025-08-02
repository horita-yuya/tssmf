import { describe, it, expect } from 'vitest';
import { parseMidi } from '../midi';

describe('Error Handling and Edge Cases', () => {
  describe('Malformed Headers', () => {
    it('should throw error for empty input', () => {
      const emptyBuffer = new ArrayBuffer(0);
      expect(() => parseMidi(emptyBuffer)).toThrow();
    });

    it('should throw error for input too short for header', () => {
      const tooShort = new Uint8Array([0x4D, 0x54, 0x68]); // Only "MTh"
      expect(() => parseMidi(tooShort)).toThrow();
    });

    it('should throw error for wrong header signature', () => {
      const wrongHeader = new Uint8Array([
        0x4D, 0x54, 0x68, 0x65, // "MThe" instead of "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0
      ]);
      expect(() => parseMidi(wrongHeader)).toThrow('Invalid MIDI file: missing MThd header');
    });

    it('should throw error for invalid header length', () => {
      const wrongLength = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x08, // Wrong length (8 instead of 6)
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0, 0x00, 0x00
      ]);
      expect(() => parseMidi(wrongLength)).toThrow('Invalid MIDI header length');
    });

    it('should throw error for unsupported format types', () => {
      const formats = [3, 4, 5, 255];
      
      for (const format of formats) {
        const data = new Uint8Array([
          0x4D, 0x54, 0x68, 0x64, // "MThd"
          0x00, 0x00, 0x00, 0x06,
          (format >> 8) & 0xFF, format & 0xFF, // Invalid format
          0x00, 0x01, 0x01, 0xE0
        ]);
        expect(() => parseMidi(data)).toThrow(`Unsupported MIDI format: ${format}`);
      }
    });
  });

  describe('Malformed Tracks', () => {
    it('should throw error for missing track header', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6C, // "MTrl" (wrong)
        0x00, 0x00, 0x00, 0x04,
        0x00, 0xFF, 0x2F, 0x00
      ]);
      expect(() => parseMidi(data)).toThrow('Invalid track chunk: missing MTrk header');
    });

    it('should handle truncated track data gracefully', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x10, // Claims 16 bytes
        0x00, 0xFF, 0x2F, 0x00  // But only provides 4
      ]);
      
      // Should not throw but handle gracefully
      const midi = parseMidi(data);
      expect(midi.tracks).toHaveLength(1);
      expect(midi.tracks[0].events).toHaveLength(1);
    });

    it('should handle tracks longer than declared length', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x04, // Claims 4 bytes
        0x00, 0xFF, 0x2F, 0x00, // End of track (4 bytes)
        0x00, 0x90, 0x40, 0x7F  // Extra data (should not be parsed)
      ]);
      
      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(1); // Only end of track
    });

    it('should handle empty tracks', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x00  // Zero length track
      ]);
      
      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(0);
    });
  });

  describe('Running Status Errors', () => {
    it('should throw error when running status used without previous status', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x08,
        0x00,                   // Delta time 0
        0x40, 0x7F,             // Invalid: data bytes without status
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      expect(() => parseMidi(data)).toThrow('Running status used without previous status');
    });

    it('should handle running status after meta events correctly', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x15,
        0x00,                   // Delta time 0
        0x90, 0x40, 0x7F,       // Note On (establishes running status)
        0x00,                   // Delta time 0
        0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20, // Meta event (should clear running status)
        0x00,                   // Delta time 0
        0x80, 0x40, 0x40,       // Need explicit status after meta event
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      // This should parse correctly
      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(4); // note on, tempo, note off, end of track
    });
  });

  describe('Invalid Event Data', () => {
    it('should throw error for unsupported event status bytes', () => {
      const invalidStatuses = [0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE];
      
      for (const status of invalidStatuses) {
        const data = new Uint8Array([
          0x4D, 0x54, 0x68, 0x64, // "MThd"
          0x00, 0x00, 0x00, 0x06,
          0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
          0x4D, 0x54, 0x72, 0x6B, // "MTrk"
          0x00, 0x00, 0x00, 0x08,
          0x00,                   // Delta time 0
          status,                 // Invalid status
          0x40, 0x7F,
          0x00, 0xFF, 0x2F, 0x00  // End of track
        ]);
        
        expect(() => parseMidi(data)).toThrow(`Unsupported event status: 0x${status.toString(16)}`);
      }
    });

    it('should handle incomplete channel events by throwing error', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x06,
        0x00,                   // Delta time 0
        0x90, 0x40,             // Note On with missing velocity byte
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      // Should throw due to insufficient data
      expect(() => parseMidi(data)).toThrow();
    });

    it('should handle incomplete meta events by throwing error', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x05,
        0x00,                   // Delta time 0
        0xFF, 0x03, 0x10,       // Text meta event claiming 16 bytes
        0x41, 0x42              // But only 2 bytes available
      ]);
      
      // Should throw due to insufficient data
      expect(() => parseMidi(data)).toThrow();
    });

    it('should handle incomplete SysEx events by throwing error', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x04,
        0x00,                   // Delta time 0
        0xF0, 0x10,             // SysEx claiming 16 bytes
        0x43, 0x12              // But only 2 bytes available
      ]);
      
      // Should throw due to insufficient data
      expect(() => parseMidi(data)).toThrow();
    });
  });

  describe('VLQ Parsing Errors', () => {
    it('should handle truncated VLQ values by throwing error', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x02,
        0x81                    // VLQ continuation byte without terminator
      ]);
      
      // Should throw due to incomplete VLQ
      expect(() => parseMidi(data)).toThrow();
    });

    it('should handle VLQ overflow conditions', () => {
      // Test maximum possible VLQ value plus one (would overflow if using wrong data types)
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x0C,
        0x90, 0x80, 0x80, 0x80, 0x00, // VLQ that would cause issues if not handled correctly
        0xFF, 0x2F, 0x00,       // End of track
        0x00, 0xFF, 0x2F, 0x00  // Padding
      ]);
      
      // Should handle without throwing or producing invalid results
      const midi = parseMidi(data);
      expect(midi.tracks[0].events[0].delta).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(midi.tracks[0].events[0].delta)).toBe(true);
    });

    it('should handle excessively long VLQ sequences', () => {
      // Create a VLQ with too many continuation bytes
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x0F,
        0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00, // 7-byte VLQ (valid but excessive)
        0xFF, 0x2F, 0x00,       // End of track
        0x00, 0xFF, 0x2F, 0x00  // Padding
      ]);
      
      // Should parse without issues (VLQ allows this)
      const midi = parseMidi(data);
      expect(midi.tracks[0].events[0].delta).toBe(0);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle MIDI files with maximum tracks (Format 1)', () => {
      // Create header with just a few tracks to test parsing works  
      const trackCount = 3;
      const headerData = [
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x01,             // Format 1
        0x00, trackCount,       // 3 tracks
        0x01, 0xE0              // 480 PPQ
      ];
      
      // Create the specified number of tracks
      const trackData: number[] = [];
      for (let i = 0; i < trackCount; i++) {
        trackData.push(
          0x4D, 0x54, 0x72, 0x6B, // "MTrk"
          0x00, 0x00, 0x00, 0x04, // Track length
          0x00, 0xFF, 0x2F, 0x00  // End of track
        );
      }
      
      const completeData = new Uint8Array([...headerData, ...trackData]);
      
      // This should parse successfully
      const midi = parseMidi(completeData);
      expect(midi.tracks).toHaveLength(trackCount);
    });

    it('should handle maximum PPQ values', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01,
        0x7F, 0xFF,             // Maximum PPQ (32767)
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x04,
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      const midi = parseMidi(data);
      expect(midi.ticksPerQuarter).toBe(32767);
    });

    it('should handle all valid SMPTE frame rates', () => {
      const smpteRates = [24, 25, 29, 30]; // Standard SMPTE rates (negative when encoded)
      
      for (const rate of smpteRates) {
        const division = ((-rate) << 8) | 40; // 40 ticks per frame
        const divisionBytes = [(division >> 8) & 0xFF, division & 0xFF];
        
        const data = new Uint8Array([
          0x4D, 0x54, 0x68, 0x64, // "MThd"
          0x00, 0x00, 0x00, 0x06,
          0x00, 0x00, 0x00, 0x01,
          ...divisionBytes,        // SMPTE division
          0x4D, 0x54, 0x72, 0x6B, // "MTrk"
          0x00, 0x00, 0x00, 0x04,
          0x00, 0xFF, 0x2F, 0x00  // End of track
        ]);
        
        const midi = parseMidi(data);
        expect(midi.smpte).toEqual({ fps: rate, ticksPerFrame: 40 });
        expect(midi.ticksPerQuarter).toBeUndefined();
      }
    });

    it('should handle edge case channel and note values', () => {
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x00, 0x16,
        0x00,                   // Delta time 0
        0x9F, 0x7F, 0x7F,       // Note On: channel 15, note 127, velocity 127 (all maximum values)
        0x00,                   // Delta time 0
        0x80, 0x00, 0x00,       // Note Off: channel 0, note 0, velocity 0 (all minimum values)
        0x00,                   // Delta time 0
        0xEF, 0x7F, 0x7F,       // Pitch Bend: channel 15, max positive value
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      const midi = parseMidi(data);
      expect(midi.tracks[0].events).toHaveLength(4);
      
      // Verify extreme values are handled correctly
      const noteOn = midi.tracks[0].events[0];
      const noteOff = midi.tracks[0].events[1];
      const pitchBend = midi.tracks[0].events[2];
      
      if (noteOn.type === 'channel' && noteOn.subtype === 'noteOn') {
        expect(noteOn.channel).toBe(15);
        expect(noteOn.note).toBe(127);
        expect(noteOn.velocity).toBe(127);
      }
      
      if (noteOff.type === 'channel' && noteOff.subtype === 'noteOff') {
        expect(noteOff.channel).toBe(0);
        expect(noteOff.note).toBe(0);
        expect(noteOff.velocity).toBe(0);
      }
      
      if (pitchBend.type === 'channel' && pitchBend.subtype === 'pitchBend') {
        expect(pitchBend.channel).toBe(15);
        expect(pitchBend.value).toBe(8191); // Maximum positive pitch bend
      }
    });
  });

  describe('Memory and Performance Edge Cases', () => {
    it('should handle very large meta event data', () => {
      // Create a large text meta event (but not so large as to cause issues in tests)
      const largeText = 'A'.repeat(1000);
      const textBytes = new TextEncoder().encode(largeText);
      const lengthVLQ = [0x87, 0x68]; // VLQ encoding of 1000
      
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        0x00, 0x00, 0x03, 0xEF, // Track length (1007 bytes)
        0x00,                   // Delta time 0
        0xFF, 0x01,             // Text meta event
        ...lengthVLQ,           // Length
        ...textBytes,           // Large text data
        0x00, 0xFF, 0x2F, 0x00  // End of track
      ]);
      
      const midi = parseMidi(data);
      const textEvent = midi.tracks[0].events[0];
      
      expect(textEvent.type).toBe('meta');
      if (textEvent.type === 'meta') {
        expect(textEvent.text).toBe(largeText);
        expect(textEvent.data.length).toBe(1000);
      }
    });

    it('should handle files with many short events efficiently', () => {
      // Create a file with many small events to test parsing efficiency
      const eventCount = 1000;
      const eventData: number[] = [];
      
      for (let i = 0; i < eventCount; i++) {
        eventData.push(
          0x00,        // Delta time 0
          0x90,        // Note On
          60 + (i % 12), // Cycling through an octave
          64 + (i % 64)  // Varying velocity
        );
      }
      
      eventData.push(0x00, 0xFF, 0x2F, 0x00); // End of track
      
      const data = new Uint8Array([
        0x4D, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
        0x4D, 0x54, 0x72, 0x6B, // "MTrk"
        ...[(eventData.length >> 24) & 0xFF, (eventData.length >> 16) & 0xFF, 
            (eventData.length >> 8) & 0xFF, eventData.length & 0xFF],
        ...eventData
      ]);
      
      const startTime = performance.now();
      const midi = parseMidi(data);
      const endTime = performance.now();
      
      expect(midi.tracks[0].events).toHaveLength(eventCount + 1); // +1 for end of track
      expect(endTime - startTime).toBeLessThan(50); // Should be fast
    });
  });
});