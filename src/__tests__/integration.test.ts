import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildTempoMap,
  type ChannelEvent,
  type MidiEvent,
  type MidiFile,
  parseMidi,
  ticksToMs,
} from "../midi";

describe("Integration Tests with Real MIDI File", () => {
  let testMidiBuffer: ArrayBuffer;
  let parsedMidi: MidiFile;

  beforeAll(() => {
    // Load and parse the test MIDI file once for all tests
    // const testMidiPath = './test_simple.mid';
    const testMidiPath = `${__dirname}/test_simple.mid`;
    const buffer = readFileSync(testMidiPath);

    // Convert Node.js Buffer to ArrayBuffer properly
    testMidiBuffer = new ArrayBuffer(buffer.length);
    const view = new Uint8Array(testMidiBuffer);
    for (let i = 0; i < buffer.length; i++) {
      view[i] = buffer[i];
    }

    parsedMidi = parseMidi(testMidiBuffer);
  });

  describe("File Structure Validation", () => {
    it("should have valid MIDI format", () => {
      expect([0, 1, 2]).toContain(parsedMidi.format);
    });

    it("should have at least one track", () => {
      expect(parsedMidi.tracks.length).toBeGreaterThan(0);
    });

    it("should have valid timing division", () => {
      // Should have either PPQ or SMPTE, but not both
      const hasPPQ = parsedMidi.ticksPerQuarter !== undefined;
      const hasSMPTE = parsedMidi.smpte !== undefined;

      expect(hasPPQ || hasSMPTE).toBe(true);
      expect(hasPPQ && hasSMPTE).toBe(false);

      if (hasPPQ) {
        expect(parsedMidi.ticksPerQuarter).toBeGreaterThan(0);
      }

      if (hasSMPTE) {
        expect(parsedMidi.smpte?.fps).toBeGreaterThan(0);
        expect(parsedMidi.smpte?.ticksPerFrame).toBeGreaterThan(0);
      }
    });

    it("should have properly terminated tracks", () => {
      for (let i = 0; i < parsedMidi.tracks.length; i++) {
        const track = parsedMidi.tracks[i];
        expect(track.events.length).toBeGreaterThan(0);

        // Last event should be End of Track
        const lastEvent = track.events[track.events.length - 1];
        expect(lastEvent.type).toBe("meta");
        if (lastEvent.type === "meta") {
          expect(lastEvent.metaType).toBe(0x2f);
          expect(lastEvent.endOfTrack).toBe(true);
        }
      }
    });
  });

  describe("Event Analysis", () => {
    it("should contain various event types", () => {
      let hasMetaEvents = false;

      for (const track of parsedMidi.tracks) {
        for (const event of track.events) {
          if (event.type === "meta") hasMetaEvents = true;
        }
      }

      expect(hasMetaEvents).toBe(true); // Should at least have End of Track
      // Channel events and SysEx are optional but we expect channel events in a typical MIDI file
    });

    it("should have valid channel event data", () => {
      for (const track of parsedMidi.tracks) {
        for (const event of track.events) {
          if (event.type === "channel") {
            const channelEvent = event as ChannelEvent;

            // Channel should be 0-15
            expect(channelEvent.channel).toBeGreaterThanOrEqual(0);
            expect(channelEvent.channel).toBeLessThanOrEqual(15);

            // Validate event-specific data
            switch (channelEvent.subtype) {
              case "noteOn":
              case "noteOff":
                expect(channelEvent.note).toBeGreaterThanOrEqual(0);
                expect(channelEvent.note).toBeLessThanOrEqual(127);
                expect(channelEvent.velocity).toBeGreaterThanOrEqual(0);
                expect(channelEvent.velocity).toBeLessThanOrEqual(127);
                break;

              case "polyAftertouch":
                expect(channelEvent.note).toBeGreaterThanOrEqual(0);
                expect(channelEvent.note).toBeLessThanOrEqual(127);
                expect(channelEvent.pressure).toBeGreaterThanOrEqual(0);
                expect(channelEvent.pressure).toBeLessThanOrEqual(127);
                break;

              case "controlChange":
                expect(channelEvent.controller).toBeGreaterThanOrEqual(0);
                expect(channelEvent.controller).toBeLessThanOrEqual(127);
                expect(channelEvent.value).toBeGreaterThanOrEqual(0);
                expect(channelEvent.value).toBeLessThanOrEqual(127);
                break;

              case "programChange":
                expect(channelEvent.program).toBeGreaterThanOrEqual(0);
                expect(channelEvent.program).toBeLessThanOrEqual(127);
                break;

              case "channelPressure":
                expect(channelEvent.pressure).toBeGreaterThanOrEqual(0);
                expect(channelEvent.pressure).toBeLessThanOrEqual(127);
                break;

              case "pitchBend":
                expect(channelEvent.value).toBeGreaterThanOrEqual(-8192);
                expect(channelEvent.value).toBeLessThanOrEqual(8191);
                break;
            }
          }
        }
      }
    });

    it("should have valid delta times", () => {
      for (const track of parsedMidi.tracks) {
        for (const event of track.events) {
          expect(event.delta).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(event.delta)).toBe(true);
        }
      }
    });

    it("should maintain event ordering within tracks", () => {
      for (const track of parsedMidi.tracks) {
        let absoluteTick = 0;

        for (const event of track.events) {
          absoluteTick += event.delta;
          expect(absoluteTick).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe("Music Data Analysis", () => {
    it("should extract note events correctly", () => {
      const noteEvents: Array<{ tick: number; event: ChannelEvent }> = [];

      for (const track of parsedMidi.tracks) {
        let absoluteTick = 0;

        for (const event of track.events) {
          absoluteTick += event.delta;

          if (
            event.type === "channel" &&
            (event.subtype === "noteOn" || event.subtype === "noteOff")
          ) {
            noteEvents.push({ tick: absoluteTick, event });
          }
        }
      }

      if (noteEvents.length > 0) {
        // Verify note events are properly structured
        for (const { event } of noteEvents) {
          expect(event.note).toBeGreaterThanOrEqual(0);
          expect(event.note).toBeLessThanOrEqual(127);
          expect(event.velocity).toBeGreaterThanOrEqual(0);
          expect(event.velocity).toBeLessThanOrEqual(127);
        }

        // Check for reasonable note range (most MIDI uses notes 21-108)
        const notes = noteEvents.map((n) => n.event.note);
        const minNote = Math.min(...notes);
        const maxNote = Math.max(...notes);

        expect(minNote).toBeGreaterThanOrEqual(0);
        expect(maxNote).toBeLessThanOrEqual(127);
      }
    });

    it("should find text/name information if present", () => {
      const textEvents: string[] = [];

      for (const track of parsedMidi.tracks) {
        for (const event of track.events) {
          if (event.type === "meta" && event.text) {
            textEvents.push(event.text);
          }
        }
      }

      // Text events are optional, but if present, should be non-empty strings
      for (const text of textEvents) {
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(0);
      }
    });

    it("should handle tempo information correctly", () => {
      const tempoMap = buildTempoMap(parsedMidi);

      expect(tempoMap.length).toBeGreaterThan(0);
      expect(tempoMap[0].tick).toBe(0); // Should start at tick 0
      expect(tempoMap[0].usPerQuarter).toBeGreaterThan(0);

      // Verify tempo map is sorted by tick
      for (let i = 1; i < tempoMap.length; i++) {
        expect(tempoMap[i].tick).toBeGreaterThanOrEqual(tempoMap[i - 1].tick);
      }

      // Test tempo utilities work with this file
      if (parsedMidi.ticksPerQuarter) {
        const ppq = parsedMidi.ticksPerQuarter;

        // Convert some ticks to milliseconds
        expect(() => ticksToMs(0, tempoMap, ppq)).not.toThrow();
        expect(() => ticksToMs(ppq, tempoMap, ppq)).not.toThrow();
        expect(() => ticksToMs(ppq * 4, tempoMap, ppq)).not.toThrow();

        // Results should be reasonable
        expect(ticksToMs(0, tempoMap, ppq)).toBe(0);
        expect(ticksToMs(ppq, tempoMap, ppq)).toBeGreaterThan(0);
      }
    });
  });

  describe("Performance and Robustness", () => {
    it("should parse quickly", () => {
      const startTime = performance.now();

      for (let i = 0; i < 10; i++) {
        parseMidi(testMidiBuffer);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 10;

      // Should parse a typical MIDI file in under 10ms on average
      expect(avgTime).toBeLessThan(10);
    });

    it("should produce consistent results on repeated parsing", () => {
      const result1 = parseMidi(testMidiBuffer);
      const result2 = parseMidi(testMidiBuffer);

      expect(result1.format).toBe(result2.format);
      expect(result1.tracks.length).toBe(result2.tracks.length);
      expect(result1.ticksPerQuarter).toBe(result2.ticksPerQuarter);

      // Compare track contents
      for (let i = 0; i < result1.tracks.length; i++) {
        expect(result1.tracks[i].events.length).toBe(
          result2.tracks[i].events.length,
        );

        for (let j = 0; j < result1.tracks[i].events.length; j++) {
          const event1 = result1.tracks[i].events[j];
          const event2 = result2.tracks[i].events[j];

          expect(event1.type).toBe(event2.type);
          expect(event1.delta).toBe(event2.delta);
        }
      }
    });

    it("should handle ArrayBuffer and Uint8Array inputs consistently", () => {
      const uint8Array = new Uint8Array(testMidiBuffer);

      const resultFromArrayBuffer = parseMidi(testMidiBuffer);
      const resultFromUint8Array = parseMidi(uint8Array);

      expect(resultFromArrayBuffer.format).toBe(resultFromUint8Array.format);
      expect(resultFromArrayBuffer.tracks.length).toBe(
        resultFromUint8Array.tracks.length,
      );
      expect(resultFromArrayBuffer.ticksPerQuarter).toBe(
        resultFromUint8Array.ticksPerQuarter,
      );
    });
  });

  describe("Musical Analysis", () => {
    it("should extract a coherent musical timeline", () => {
      const timeline: Array<{ tick: number; type: string; event: MidiEvent }> =
        [];

      for (
        let trackIndex = 0;
        trackIndex < parsedMidi.tracks.length;
        trackIndex++
      ) {
        const track = parsedMidi.tracks[trackIndex];
        let absoluteTick = 0;

        for (const event of track.events) {
          absoluteTick += event.delta;
          timeline.push({
            tick: absoluteTick,
            type: event.type,
            event: event,
          });
        }
      }

      // Sort by tick for global timeline
      timeline.sort((a, b) => a.tick - b.tick);

      // Validate timeline makes musical sense
      expect(timeline.length).toBeGreaterThan(0);
      expect(timeline[0].tick).toBeGreaterThanOrEqual(0);

      // Check for reasonable event distribution
      const eventTypes = new Set(timeline.map((t) => t.type));
      expect(eventTypes.has("meta")).toBe(true); // Should have at least meta events

      // Find the last event - should be End of Track
      const lastEvents = timeline.filter(
        (t) => t.tick === Math.max(...timeline.map((e) => e.tick)),
      );
      const hasEndOfTrack = lastEvents.some(
        (e) => e.type === "meta" && e.event.metaType === 0x2f,
      );
      expect(hasEndOfTrack).toBe(true);
    });

    it("should handle polyphonic note patterns if present", () => {
      const activeNotes = new Map<
        string,
        { tick: number; channel: number; velocity: number }
      >();
      const noteEvents: Array<{
        tick: number;
        action: string;
        note: number;
        channel: number;
      }> = [];

      for (const track of parsedMidi.tracks) {
        let absoluteTick = 0;

        for (const event of track.events) {
          absoluteTick += event.delta;

          if (event.type === "channel") {
            if (event.subtype === "noteOn" && event.velocity > 0) {
              const key = `${event.channel}-${event.note}`;
              activeNotes.set(key, {
                tick: absoluteTick,
                channel: event.channel,
                velocity: event.velocity,
              });
              noteEvents.push({
                tick: absoluteTick,
                action: "on",
                note: event.note,
                channel: event.channel,
              });
            } else if (
              event.subtype === "noteOff" ||
              (event.subtype === "noteOn" && event.velocity === 0)
            ) {
              const key = `${event.channel}-${event.note}`;
              activeNotes.delete(key);
              noteEvents.push({
                tick: absoluteTick,
                action: "off",
                note: event.note,
                channel: event.channel,
              });
            }
          }
        }
      }

      // If we have note events, validate they follow musical conventions
      if (noteEvents.length > 0) {
        // Check for reasonable note durations
        const noteOffs = noteEvents.filter((e) => e.action === "off");

        // In a well-formed MIDI file, we should have some note off events
        // (though not necessarily equal numbers due to sustain, overlaps, etc.)
        expect(noteOffs.length).toBeGreaterThan(0);

        // Check for reasonable note ranges per channel
        const channelStats = new Map<
          number,
          { minNote: number; maxNote: number; count: number }
        >();

        for (const noteEvent of noteEvents) {
          if (!channelStats.has(noteEvent.channel)) {
            channelStats.set(noteEvent.channel, {
              minNote: noteEvent.note,
              maxNote: noteEvent.note,
              count: 0,
            });
          }

          const stats = channelStats.get(noteEvent.channel);
          if (!stats) continue;
          stats.minNote = Math.min(stats.minNote, noteEvent.note);
          stats.maxNote = Math.max(stats.maxNote, noteEvent.note);
          stats.count++;
        }

        // Validate each channel has reasonable note ranges
        for (const [, stats] of channelStats) {
          expect(stats.minNote).toBeGreaterThanOrEqual(0);
          expect(stats.maxNote).toBeLessThanOrEqual(127);
          expect(stats.maxNote).toBeGreaterThanOrEqual(stats.minNote);
        }
      }
    });
  });
});
