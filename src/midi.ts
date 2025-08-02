// midi.ts — zero-dep, ECMAScript-only MIDI parser (TypeScript)

export type MidiFormat = 0 | 1 | 2;

export interface MidiFile {
  format: MidiFormat;
  tracks: MidiTrack[];
  ticksPerQuarter?: number; // if division is PPQ
  smpte?: { fps: number; ticksPerFrame: number }; // if division is SMPTE
}

export interface MidiTrack {
  events: MidiEvent[];
}

export type MidiEvent = ChannelEvent | MetaEvent | SysExEvent;

export type ChannelEvent =
  | {
      delta: number;
      type: "channel";
      subtype: "noteOff";
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "noteOn";
      channel: number;
      note: number;
      velocity: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "polyAftertouch";
      channel: number;
      note: number;
      pressure: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "controlChange";
      channel: number;
      controller: number;
      value: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "programChange";
      channel: number;
      program: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "channelPressure";
      channel: number;
      pressure: number;
    }
  | {
      delta: number;
      type: "channel";
      subtype: "pitchBend";
      channel: number;
      value: number;
    }; // 14-bit signed center=0

export interface MetaEvent {
  delta: number;
  type: "meta";
  metaType: number;
  data: Uint8Array;
  // common conveniences (filled when applicable)
  text?: string; // 0x01…0x07 text-y types
  tempoUsPerQuarter?: number; // 0x51
  timeSig?: {
    num: number;
    den: number;
    metronome: number;
    thirtyseconds: number;
  }; // 0x58
  keySig?: { sf: number; minor: boolean }; // 0x59
  endOfTrack?: true; // 0x2F
}

export interface SysExEvent {
  delta: number;
  type: "sysex";
  kind: 0xf0 | 0xf7;
  data: Uint8Array; // raw payload
}

export interface TempoPoint {
  tick: number;
  usPerQuarter: number;
}

class MidiParser {
  private view: DataView;
  private offset: number = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
    } else {
      this.view = new DataView(buffer);
    }
  }

  private readUint8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  private readUint16(): number {
    const value = this.view.getUint16(this.offset, false); // big-endian
    this.offset += 2;
    return value;
  }

  private readUint32(): number {
    const value = this.view.getUint32(this.offset, false); // big-endian
    this.offset += 4;
    return value;
  }

  private readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      length,
    );
    this.offset += length;
    return bytes;
  }

  private readString(length: number): string {
    const bytes = this.readBytes(length);
    return String.fromCharCode(...bytes);
  }

  private readVariableLengthQuantity(): number {
    let value = 0;
    let byte: number;

    do {
      byte = this.readUint8();
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);

    return value;
  }

  private parseHeader(): {
    format: MidiFormat;
    numTracks: number;
    division: number;
  } {
    // Read and validate header chunk type
    const headerType = this.readString(4);
    if (headerType !== "MThd") {
      throw new Error("Invalid MIDI file: missing MThd header");
    }

    // Read header length (should be 6)
    const headerLength = this.readUint32();
    if (headerLength !== 6) {
      throw new Error("Invalid MIDI header length");
    }

    // Read format type
    const format = this.readUint16();
    if (format !== 0 && format !== 1 && format !== 2) {
      throw new Error(`Unsupported MIDI format: ${format}`);
    }

    // Read number of tracks
    const numTracks = this.readUint16();

    // Read division (time division)
    const division = this.readUint16();

    return { format: format as MidiFormat, numTracks, division };
  }

  private parseTrack(): MidiTrack {
    // Read and validate track chunk type
    const trackType = this.readString(4);
    if (trackType !== "MTrk") {
      throw new Error("Invalid track chunk: missing MTrk header");
    }

    // Read track length
    const trackLength = this.readUint32();
    const trackEnd = this.offset + trackLength;

    const events: MidiEvent[] = [];
    let runningStatus: number | null = null;

    while (this.offset < trackEnd) {
      // Read delta time
      const delta = this.readVariableLengthQuantity();

      // Read status byte or use running status
      let statusByte = this.view.getUint8(this.offset);

      if (statusByte < 0x80) {
        // Running status - reuse previous status
        if (runningStatus === null) {
          throw new Error("Running status used without previous status");
        }
        statusByte = runningStatus;
      } else {
        // New status byte
        this.offset += 1;
        if (statusByte < 0xf0) {
          runningStatus = statusByte;
        }
      }

      const event = this.parseEvent(delta, statusByte);
      events.push(event);

      // End of track event terminates parsing
      if (event.type === "meta" && event.metaType === 0x2f) {
        break;
      }
    }

    return { events };
  }

  private parseEvent(delta: number, statusByte: number): MidiEvent {
    if (statusByte >= 0x80 && statusByte <= 0xef) {
      // Channel event
      return this.parseChannelEvent(delta, statusByte);
    } else if (statusByte === 0xff) {
      // Meta event
      return this.parseMetaEvent(delta);
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      // SysEx event
      return this.parseSysExEvent(delta, statusByte);
    } else {
      throw new Error(`Unsupported event status: 0x${statusByte.toString(16)}`);
    }
  }

  private parseChannelEvent(delta: number, statusByte: number): ChannelEvent {
    const channel = statusByte & 0x0f;
    const eventType = (statusByte & 0xf0) >> 4;

    switch (eventType) {
      case 0x8: // Note Off
        return {
          delta,
          type: "channel",
          subtype: "noteOff",
          channel,
          note: this.readUint8(),
          velocity: this.readUint8(),
        };

      case 0x9: // Note On
        return {
          delta,
          type: "channel",
          subtype: "noteOn",
          channel,
          note: this.readUint8(),
          velocity: this.readUint8(),
        };

      case 0xa: // Polyphonic Key Pressure
        return {
          delta,
          type: "channel",
          subtype: "polyAftertouch",
          channel,
          note: this.readUint8(),
          pressure: this.readUint8(),
        };

      case 0xb: // Control Change
        return {
          delta,
          type: "channel",
          subtype: "controlChange",
          channel,
          controller: this.readUint8(),
          value: this.readUint8(),
        };

      case 0xc: // Program Change
        return {
          delta,
          type: "channel",
          subtype: "programChange",
          channel,
          program: this.readUint8(),
        };

      case 0xd: // Channel Pressure
        return {
          delta,
          type: "channel",
          subtype: "channelPressure",
          channel,
          pressure: this.readUint8(),
        };

      case 0xe: {
        // Pitch Bend
        const lsb = this.readUint8();
        const msb = this.readUint8();
        const value = ((msb << 7) | lsb) - 8192; // Convert to signed, center at 0
        return {
          delta,
          type: "channel",
          subtype: "pitchBend",
          channel,
          value,
        };
      }

      default:
        throw new Error(
          `Unknown channel event type: 0x${eventType.toString(16)}`,
        );
    }
  }

  private parseMetaEvent(delta: number): MetaEvent {
    const metaType = this.readUint8();
    const length = this.readVariableLengthQuantity();
    const data = this.readBytes(length);

    const event: MetaEvent = {
      delta,
      type: "meta",
      metaType,
      data,
    };

    // Add convenience fields for common meta events
    if (metaType >= 0x01 && metaType <= 0x07) {
      // Text events
      const decoder = new TextDecoder("latin1");
      event.text = decoder.decode(data);
    } else if (metaType === 0x51 && length === 3) {
      // Set Tempo
      event.tempoUsPerQuarter = (data[0] << 16) | (data[1] << 8) | data[2];
    } else if (metaType === 0x58 && length === 4) {
      // Time Signature
      event.timeSig = {
        num: data[0],
        den: 2 ** data[1],
        metronome: data[2],
        thirtyseconds: data[3],
      };
    } else if (metaType === 0x59 && length === 2) {
      // Key Signature
      const sf = data[0] > 127 ? data[0] - 256 : data[0]; // Convert to signed byte
      event.keySig = {
        sf,
        minor: data[1] === 1,
      };
    } else if (metaType === 0x2f) {
      // End of Track
      event.endOfTrack = true;
    }

    return event;
  }

  private parseSysExEvent(delta: number, statusByte: number): SysExEvent {
    const length = this.readVariableLengthQuantity();
    const data = this.readBytes(length);

    return {
      delta,
      type: "sysex",
      kind: statusByte as 0xf0 | 0xf7,
      data,
    };
  }

  parse(): MidiFile {
    // Parse header
    const { format, numTracks, division } = this.parseHeader();

    // Parse division to extract timing information
    let ticksPerQuarter: number | undefined;
    let smpte: { fps: number; ticksPerFrame: number } | undefined;

    if (division & 0x8000) {
      // SMPTE division
      const fpsRaw = (division >> 8) & 0xff;
      const fps = fpsRaw > 127 ? fpsRaw - 256 : fpsRaw; // Convert to signed byte
      const ticksPerFrame = division & 0xff;
      smpte = { fps: Math.abs(fps), ticksPerFrame };
    } else {
      // PPQ (Pulses Per Quarter note)
      ticksPerQuarter = division;
    }

    // Parse tracks
    const tracks: MidiTrack[] = [];
    for (let i = 0; i < numTracks; i++) {
      tracks.push(this.parseTrack());
    }

    const result: MidiFile = {
      format,
      tracks,
    };

    if (ticksPerQuarter !== undefined) {
      result.ticksPerQuarter = ticksPerQuarter;
    }

    if (smpte !== undefined) {
      result.smpte = smpte;
    }

    return result;
  }
}

export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFile {
  const parser = new MidiParser(input);
  return parser.parse();
}

export function buildTempoMap(midi: MidiFile): TempoPoint[] {
  const tempoMap: TempoPoint[] = [];
  let hasInitialTempo = false;

  // Scan all tracks for tempo change events
  for (const track of midi.tracks) {
    let absoluteTick = 0;

    for (const event of track.events) {
      absoluteTick += event.delta;

      if (
        event.type === "meta" &&
        event.metaType === 0x51 &&
        event.tempoUsPerQuarter !== undefined
      ) {
        const currentTempo = event.tempoUsPerQuarter;

        // Find insertion point to maintain sorted order
        let insertIndex = tempoMap.length;
        for (let i = 0; i < tempoMap.length; i++) {
          const tempoPoint = tempoMap[i];
          if (tempoPoint && tempoPoint.tick > absoluteTick) {
            insertIndex = i;
            break;
          } else if (tempoPoint && tempoPoint.tick === absoluteTick) {
            // Update existing tempo point
            tempoPoint.usPerQuarter = currentTempo;
            insertIndex = -1;
            break;
          }
        }

        if (insertIndex >= 0) {
          tempoMap.splice(insertIndex, 0, {
            tick: absoluteTick,
            usPerQuarter: currentTempo,
          });
          if (absoluteTick === 0) {
            hasInitialTempo = true;
          }
        }
      }
    }
  }

  // Add default tempo at tick 0 if no tempo event exists there
  if (!hasInitialTempo) {
    tempoMap.unshift({ tick: 0, usPerQuarter: 500000 });
  }

  return tempoMap;
}

export function ticksToMs(
  tick: number,
  tempoMap: TempoPoint[],
  ppq: number,
): number {
  if (tempoMap.length === 0) {
    throw new Error("Tempo map is empty");
  }

  if (ppq <= 0) {
    throw new Error("PPQ must be greater than zero");
  }

  let totalMs = 0;
  let currentTick = 0;

  for (let i = 0; i < tempoMap.length; i++) {
    const currentTempoPoint = tempoMap[i];
    if (!currentTempoPoint) continue;

    const nextTempoPoint = i < tempoMap.length - 1 ? tempoMap[i + 1] : null;

    // Determine the end of this tempo segment
    const segmentStartTick = Math.max(currentTick, currentTempoPoint.tick);
    const segmentEndTick = nextTempoPoint
      ? Math.min(nextTempoPoint.tick, tick)
      : tick;

    // If the segment has duration and we haven't reached our target tick yet
    if (segmentEndTick > segmentStartTick && segmentStartTick < tick) {
      const ticksInSegment = segmentEndTick - segmentStartTick;
      const msInSegment =
        (ticksInSegment * currentTempoPoint.usPerQuarter) / (ppq * 1000);
      totalMs += msInSegment;
      currentTick = segmentEndTick;
    }

    if (currentTick >= tick) {
      break;
    }
  }

  return totalMs;
}
