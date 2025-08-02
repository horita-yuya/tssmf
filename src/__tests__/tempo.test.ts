import { describe, expect, it } from "vitest";
import {
  buildTempoMap,
  type MidiFile,
  type TempoPoint,
  ticksToMs,
} from "../midi";

describe("Tempo Utilities Advanced Tests", () => {
  describe("buildTempoMap", () => {
    it("should handle Format 0 files with tempo in single track", () => {
      const midi: MidiFile = {
        format: 0,
        tracks: [
          {
            events: [
              {
                delta: 0,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array([0x06, 0x1a, 0x80]),
                tempoUsPerQuarter: 400000,
              },
              {
                delta: 480,
                type: "channel",
                subtype: "noteOn",
                channel: 0,
                note: 60,
                velocity: 80,
              },
              {
                delta: 480,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array([0x07, 0xa1, 0x20]),
                tempoUsPerQuarter: 500000,
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
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 400000 });
      expect(tempoMap[1]).toEqual({ tick: 960, usPerQuarter: 500000 });
    });

    it("should handle Format 1 files with tempo changes in multiple tracks", () => {
      const midi: MidiFile = {
        format: 1,
        tracks: [
          {
            // Track 0: Tempo track
            events: [
              {
                delta: 0,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 600000,
              }, // 100 BPM
              {
                delta: 1920,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 300000,
              }, // 200 BPM
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
            // Track 1: Music track with some tempo changes
            events: [
              {
                delta: 960,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 400000,
              }, // 150 BPM
              {
                delta: 480,
                type: "channel",
                subtype: "noteOn",
                channel: 0,
                note: 60,
                velocity: 80,
              },
              {
                delta: 960,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 250000,
              }, // 240 BPM
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

      // Should be sorted by tick and include all unique tempo changes
      expect(tempoMap).toHaveLength(4);
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 600000 });
      expect(tempoMap[1]).toEqual({ tick: 960, usPerQuarter: 400000 });
      expect(tempoMap[2]).toEqual({ tick: 1920, usPerQuarter: 300000 });
      expect(tempoMap[3]).toEqual({ tick: 2400, usPerQuarter: 250000 });
    });

    it("should handle overlapping tempo changes at same tick", () => {
      const midi: MidiFile = {
        format: 1,
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
              }, // Same tick, different tempo
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

      // Should have one entry at tick 480, using the last tempo found
      expect(tempoMap).toHaveLength(2);
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 }); // Default
      expect(tempoMap[1]).toEqual({ tick: 480, usPerQuarter: 450000 }); // Last one wins
    });

    it("should maintain sorted order when tracks have different tempo timings", () => {
      const midi: MidiFile = {
        format: 1,
        tracks: [
          {
            events: [
              {
                delta: 1000,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 400000,
              },
              {
                delta: 2000,
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
                delta: 500,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 450000,
              },
              {
                delta: 1500,
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

      // Should be properly sorted by tick
      expect(tempoMap).toHaveLength(5);
      expect(tempoMap[0].tick).toBe(0);
      expect(tempoMap[1].tick).toBe(500);
      expect(tempoMap[2].tick).toBe(1000);
      expect(tempoMap[3].tick).toBe(2000);
      expect(tempoMap[4].tick).toBe(3000);

      // Verify the ticks are in ascending order
      for (let i = 1; i < tempoMap.length; i++) {
        expect(tempoMap[i].tick).toBeGreaterThanOrEqual(tempoMap[i - 1].tick);
      }
    });

    it("should ignore non-tempo meta events", () => {
      const midi: MidiFile = {
        format: 0,
        tracks: [
          {
            events: [
              {
                delta: 0,
                type: "meta",
                metaType: 0x03,
                data: new Uint8Array(),
                text: "Track Name",
              },
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
                metaType: 0x58,
                data: new Uint8Array(),
                timeSig: { num: 4, den: 4, metronome: 24, thirtyseconds: 8 },
              },
              {
                delta: 480,
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

      // Should only include tempo changes, not other meta events
      expect(tempoMap).toHaveLength(3);
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 }); // Default since no tempo at tick 0
      expect(tempoMap[1]).toEqual({ tick: 480, usPerQuarter: 400000 });
      expect(tempoMap[2]).toEqual({ tick: 960, usPerQuarter: 350000 });
    });

    it("should handle empty tracks", () => {
      const midi: MidiFile = {
        format: 1,
        tracks: [
          { events: [] },
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
          { events: [] },
        ],
        ticksPerQuarter: 480,
      };

      const tempoMap = buildTempoMap(midi);

      expect(tempoMap).toHaveLength(1);
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 500000 }); // Default only
    });
  });

  describe("ticksToMs", () => {
    it("should handle precision with fractional milliseconds", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }]; // 120 BPM
      const ppq = 480;

      // Test various fractional tick values
      expect(ticksToMs(240, tempoMap, ppq)).toBeCloseTo(250, 3); // Half quarter note
      expect(ticksToMs(120, tempoMap, ppq)).toBeCloseTo(125, 3); // Quarter of quarter note
      expect(ticksToMs(60, tempoMap, ppq)).toBeCloseTo(62.5, 3); // Eighth of quarter note
    });

    it("should handle very fast tempos accurately", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 100000 }]; // 600 BPM
      const ppq = 960;

      expect(ticksToMs(960, tempoMap, ppq)).toBeCloseTo(100, 1); // One quarter note = 100ms
      expect(ticksToMs(480, tempoMap, ppq)).toBeCloseTo(50, 1); // Half quarter note = 50ms
    });

    it("should handle very slow tempos accurately", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 2000000 }]; // 30 BPM
      const ppq = 480;

      expect(ticksToMs(480, tempoMap, ppq)).toBeCloseTo(2000, 1); // One quarter note = 2000ms
      expect(ticksToMs(240, tempoMap, ppq)).toBeCloseTo(1000, 1); // Half quarter note = 1000ms
    });

    it("should handle complex tempo changes with high precision", () => {
      const tempoMap: TempoPoint[] = [
        { tick: 0, usPerQuarter: 600000 }, // 100 BPM
        { tick: 300, usPerQuarter: 400000 }, // 150 BPM (5/8 into first quarter)
        { tick: 800, usPerQuarter: 200000 }, // 300 BPM
      ];
      const ppq = 480;

      // Calculate expected time for tick 1200:
      // 0-300: 300 ticks at 100 BPM = (300 * 600000) / (480 * 1000) = 375ms
      // 300-800: 500 ticks at 150 BPM = (500 * 400000) / (480 * 1000) = 416.67ms
      // 800-1200: 400 ticks at 300 BPM = (400 * 200000) / (480 * 1000) = 166.67ms
      // Total ≈ 958.33ms

      expect(ticksToMs(1200, tempoMap, ppq)).toBeCloseTo(958.33, 1);
    });

    it("should handle ticks exactly at tempo change points", () => {
      const tempoMap: TempoPoint[] = [
        { tick: 0, usPerQuarter: 500000 }, // 120 BPM
        { tick: 480, usPerQuarter: 400000 }, // 150 BPM
        { tick: 960, usPerQuarter: 300000 }, // 200 BPM
      ];
      const ppq = 480;

      // Tick 480 (exactly at first tempo change)
      expect(ticksToMs(480, tempoMap, ppq)).toBeCloseTo(500, 1);

      // Tick 960 (exactly at second tempo change)
      // 0-480: 480 ticks at 120 BPM = 500ms
      // 480-960: 480 ticks at 150 BPM = 400ms
      // Total = 900ms
      expect(ticksToMs(960, tempoMap, ppq)).toBeCloseTo(900, 1);
    });

    it("should handle very large tick values", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }]; // 120 BPM
      const ppq = 480;

      const largeTick = 1000000; // 1 million ticks
      const expectedMs = (largeTick * 500000) / (ppq * 1000);

      expect(ticksToMs(largeTick, tempoMap, ppq)).toBeCloseTo(expectedMs, 0);
    });

    it("should handle edge case where tick equals tempo map tick exactly", () => {
      const tempoMap: TempoPoint[] = [
        { tick: 0, usPerQuarter: 500000 },
        { tick: 1000, usPerQuarter: 400000 },
      ];
      const ppq = 480;

      // Request time for tick 1000 (exactly at tempo change)
      const expectedMs = (1000 * 500000) / (480 * 1000); // Only first tempo applies
      expect(ticksToMs(1000, tempoMap, ppq)).toBeCloseTo(expectedMs, 1);
    });

    it("should handle tempo map with single point at non-zero tick", () => {
      const tempoMap: TempoPoint[] = [{ tick: 500, usPerQuarter: 400000 }];
      const ppq = 480;

      // With our current algorithm, only the portion from tick 500 onwards uses the 400000 tempo
      // Ticks 0-500 get no tempo (effectively 0), then 500-1000 use the 400000 tempo
      const expectedMs = ((1000 - 500) * 400000) / (480 * 1000);
      expect(ticksToMs(1000, tempoMap, ppq)).toBeCloseTo(expectedMs, 1);
    });

    it("should maintain precision across multiple tempo segments", () => {
      const tempoMap: TempoPoint[] = [
        { tick: 0, usPerQuarter: 500000 }, // 120 BPM
        { tick: 100, usPerQuarter: 400000 }, // 150 BPM
        { tick: 200, usPerQuarter: 300000 }, // 200 BPM
        { tick: 300, usPerQuarter: 600000 }, // 100 BPM
        { tick: 400, usPerQuarter: 500000 }, // 120 BPM
      ];
      const ppq = 480;

      // Calculate manually:
      // 0-100: 100 * 500000 / (480 * 1000) = 104.17ms
      // 100-200: 100 * 400000 / (480 * 1000) = 83.33ms
      // 200-300: 100 * 300000 / (480 * 1000) = 62.5ms
      // 300-400: 100 * 600000 / (480 * 1000) = 125ms
      // 400-500: 100 * 500000 / (480 * 1000) = 104.17ms
      // Total ≈ 479.17ms

      expect(ticksToMs(500, tempoMap, ppq)).toBeCloseTo(479.17, 1);
    });

    it("should handle zero PPQ gracefully", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }];

      // This would cause division by zero - should handle gracefully
      expect(() => ticksToMs(480, tempoMap, 0)).toThrow();
    });

    it("should handle negative ticks", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }];
      const ppq = 480;

      // Negative ticks don't make sense in MIDI context, but test robustness
      // The function should handle this gracefully, likely returning negative time
      const result = ticksToMs(-480, tempoMap, ppq);
      expect(typeof result).toBe("number");
      expect(result).toBeLessThanOrEqual(0);
    });

    it("should handle very high resolution PPQ values", () => {
      const tempoMap: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }]; // 120 BPM
      const ppq = 9600; // Very high resolution

      expect(ticksToMs(9600, tempoMap, ppq)).toBeCloseTo(500, 1); // One quarter note
      expect(ticksToMs(4800, tempoMap, ppq)).toBeCloseTo(250, 1); // Half quarter note
    });
  });

  describe("Tempo Utilities Integration", () => {
    it("should work correctly with real-world tempo changes", () => {
      // Simulate a piece that starts slow, speeds up, then slows down
      const midi: MidiFile = {
        format: 1,
        tracks: [
          {
            events: [
              // Start at 60 BPM
              {
                delta: 0,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 1000000,
              },
              // Speed up to 120 BPM after 4 quarters
              {
                delta: 1920,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 500000,
              },
              // Speed up to 180 BPM after 4 more quarters
              {
                delta: 1920,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 333333,
              },
              // Slow down to 90 BPM after 2 quarters
              {
                delta: 960,
                type: "meta",
                metaType: 0x51,
                data: new Uint8Array(),
                tempoUsPerQuarter: 666666,
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
      const ppq = midi.ticksPerQuarter!;

      // Verify tempo map structure
      expect(tempoMap).toHaveLength(4);
      expect(tempoMap[0]).toEqual({ tick: 0, usPerQuarter: 1000000 });
      expect(tempoMap[1]).toEqual({ tick: 1920, usPerQuarter: 500000 });
      expect(tempoMap[2]).toEqual({ tick: 3840, usPerQuarter: 333333 });
      expect(tempoMap[3]).toEqual({ tick: 4800, usPerQuarter: 666666 });

      // Test timing calculations
      // After 4 quarters at 60 BPM: 4 * 1000ms = 4000ms
      expect(ticksToMs(1920, tempoMap, ppq)).toBeCloseTo(4000, 1);

      // After 4 more quarters at 120 BPM: 4000ms + 4 * 500ms = 6000ms
      expect(ticksToMs(3840, tempoMap, ppq)).toBeCloseTo(6000, 1);

      // After 2 more quarters at 180 BPM: 6000ms + 2 * 333.33ms = 6666.67ms
      expect(ticksToMs(4800, tempoMap, ppq)).toBeCloseTo(6666.67, 1);

      // After 2 more quarters at 90 BPM: 6666.67ms + 2 * 666.67ms = 8000ms
      expect(ticksToMs(5760, tempoMap, ppq)).toBeCloseTo(8000, 1);
    });
  });
});
