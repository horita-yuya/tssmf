// midi.ts — zero-dep, ECMAScript-only MIDI parser (TypeScript)

/// <reference lib="dom" />

export type MidiFormat = 0 | 1 | 2;

type MidiNoteNumber =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39
  | 40
  | 41
  | 42
  | 43
  | 44
  | 45
  | 46
  | 47
  | 48
  | 49
  | 50
  | 51
  | 52
  | 53
  | 54
  | 55
  | 56
  | 57
  | 58
  | 59
  | 60
  | 61
  | 62
  | 63
  | 64
  | 65
  | 66
  | 67
  | 68
  | 69
  | 70
  | 71
  | 72
  | 73
  | 74
  | 75
  | 76
  | 77
  | 78
  | 79
  | 80
  | 81
  | 82
  | 83
  | 84
  | 85
  | 86
  | 87
  | 88
  | 89
  | 90
  | 91
  | 92
  | 93
  | 94
  | 95
  | 96
  | 97
  | 98
  | 99
  | 100
  | 101
  | 102
  | 103
  | 104
  | 105
  | 106
  | 107
  | 108
  | 109
  | 110
  | 111
  | 112
  | 113
  | 114
  | 115
  | 116
  | 117
  | 118
  | 119
  | 120
  | 121
  | 122
  | 123
  | 124
  | 125
  | 126
  | 127;

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
      type: "channel";
      subtype: "noteOff";
      delta: number;
      channel: number;
      note: MidiNoteNumber;
      velocity: number;
    }
  | {
      type: "channel";
      subtype: "noteOn";
      delta: number;
      channel: number;
      note: MidiNoteNumber;
      velocity: number;
    }
  | {
      type: "channel";
      subtype: "polyAftertouch";
      delta: number;
      channel: number;
      note: MidiNoteNumber;
      pressure: number;
    }
  | {
      type: "channel";
      subtype: "controlChange";
      delta: number;
      channel: number;
      controller: number;
      value: number;
    }
  | {
      type: "channel";
      subtype: "programChange";
      delta: number;
      channel: number;
      program: number;
    }
  | {
      type: "channel";
      subtype: "channelPressure";
      delta: number;
      channel: number;
      pressure: number;
    }
  | {
      type: "channel";
      subtype: "pitchBend";
      delta: number;
      channel: number;
      value: number;
    }; // 14-bit signed center=0

export interface MetaEvent {
  type: "meta";
  delta: number;
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
  type: "sysex";
  delta: number;
  kind: 0xf0 | 0xf7;
  data: Uint8Array; // raw payload
}

export interface TempoPoint {
  tick: number;
  usPerQuarter: number;
}

export type TempoSource = "all" | "track0" | "merge";

export interface ParseOptions {
  normalizeZeroVelocityNoteOn?: boolean;
  tempoSource?: TempoSource;
  textDecoders?: TextDecoder[];
}

class MidiParseError extends Error {
  constructor(message: string, public offset: number) {
    super(`${message} (at 0x${offset.toString(16)})`);
  }
}

class MidiParser {
  private view: DataView;
  private offset: number = 0;
  private readonly opts: Required<ParseOptions>;
  private readonly textDecoders: TextDecoder[];

  constructor(buffer: ArrayBuffer | Uint8Array, options: ParseOptions = {}) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
    } else {
      this.view = new DataView(buffer);
    }
    this.opts = {
      normalizeZeroVelocityNoteOn: options.normalizeZeroVelocityNoteOn ?? true,
      tempoSource: options.tempoSource ?? "track0",
      textDecoders: options.textDecoders ?? [new TextDecoder("latin1"), new TextDecoder("utf-8")],
    };
    this.textDecoders = this.opts.textDecoders;
  }

  private ensureAvailable(n: number) {
    const remaining = this.view.byteLength - this.offset;
    if (n > remaining) {
      throw new MidiParseError(`Unexpected EOF: need ${n} bytes`, this.offset);
    }
  }

  private decodeText(bytes: Uint8Array): string {
    for (const dec of this.textDecoders) {
      try {
        return dec.decode(bytes);
      } catch {
        continue;
      }
    }
    // Fallback to latin1
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  }

  private readFourCC(): string {
    const bytes = this.readBytes(4);
    let s = "";
    for (let i = 0; i < 4; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  }

  private readUint8(): MidiNoteNumber {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value as MidiNoteNumber;
  }

  private readUint16(): number {
    this.ensureAvailable(2);
    const value = this.view.getUint16(this.offset, false); // big-endian
    this.offset += 2;
    return value;
  }

  private readUint32(): number {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.offset, false); // big-endian
    this.offset += 4;
    return value;
  }

  private readBytes(length: number): Uint8Array {
    this.ensureAvailable(length);
    const bytes = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      length,
    );
    this.offset += length;
    return bytes;
  }

  private readString(length: number): string {
    if (length === 4) {
      return this.readFourCC();
    }
    const bytes = this.readBytes(length);
    return String.fromCharCode(...bytes);
  }

  private readVariableLengthQuantity(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.readUint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new MidiParseError("VLQ too long (over 4 bytes)", this.offset);
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
    let pendingSysEx: Uint8Array | null = null;

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

      const ev = this.parseEvent(delta, statusByte, pendingSysEx);
      events.push(ev);

      // Handle SysEx continuation state
      if (ev.type === "sysex") {
        pendingSysEx = (ev as any).__pendingSyx ?? null;
        delete (ev as any).__pendingSyx;
      } else {
        pendingSysEx = null;
      }

      // End of track event terminates parsing
      if (ev.type === "meta" && ev.metaType === 0x2f) {
        break;
      }
    }

    return { events };
  }

  private parseEvent(
    delta: number,
    statusByte: number,
    pendingSysEx: Uint8Array | null,
  ): MidiEvent {
    if (statusByte >= 0x80 && statusByte <= 0xef) {
      return this.parseChannelEvent(delta, statusByte);
    } else if (statusByte === 0xff) {
      return this.parseMetaEvent(delta);
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      return this.parseSysExEvent(delta, statusByte, pendingSysEx);
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

      case 0x9: { // Note On
        const note = this.readUint8();
        const velocity = this.readUint8();
        
        if (this.opts.normalizeZeroVelocityNoteOn && velocity === 0) {
          return {
            delta,
            type: "channel",
            subtype: "noteOff",
            channel,
            note: note as MidiNoteNumber,
            velocity: 64,
          };
        }
        
        return {
          delta,
          type: "channel",
          subtype: "noteOn",
          channel,
          note,
          velocity,
        };
      }

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
      event.text = this.decodeText(data);
    } else if (metaType === 0x51 && length === 3) {
      // Set Tempo
      event.tempoUsPerQuarter = (data[0]! << 16) | (data[1]! << 8) | data[2]!;
    } else if (metaType === 0x58 && length === 4) {
      // Time Signature
      event.timeSig = {
        num: data[0]!,
        den: 1 << data[1]!,
        metronome: data[2]!,
        thirtyseconds: data[3]!,
      };
    } else if (metaType === 0x59 && length === 2) {
      // Key Signature
      const sf = data[0]! > 127 ? data[0]! - 256 : data[0]!; // Convert to signed byte
      event.keySig = {
        sf,
        minor: data[1]! === 1,
      };
    } else if (metaType === 0x2f) {
      // End of Track
      event.endOfTrack = true;
    }

    return event;
  }

  private parseSysExEvent(
    delta: number,
    statusByte: number,
    pending: Uint8Array | null,
  ): SysExEvent {
    const length = this.readVariableLengthQuantity();
    const payload = this.readBytes(length);

    let combined = payload;
    let nextPending: Uint8Array | null = null;

    if (statusByte === 0xf0) {
      // New SysEx start
      combined = payload;
      nextPending = payload;
    } else if (statusByte === 0xf7) {
      // Continuation or escape
      if (pending) {
        const merged = new Uint8Array(pending.length + payload.length);
        merged.set(pending, 0);
        merged.set(payload, pending.length);
        combined = merged;
      } else {
        combined = payload;
      }
      nextPending = combined;
    }

    const ev: SysExEvent = {
      delta,
      type: "sysex",
      kind: statusByte as 0xf0 | 0xf7,
      data: combined,
    };
    (ev as any).__pendingSyx = nextPending;
    return ev;
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

export function parseMidi(
  input: ArrayBuffer | Uint8Array,
  opts: ParseOptions = {},
): MidiFile {
  const parser = new MidiParser(input, opts);
  return parser.parse();
}

export function buildTempoMap(
  midi: MidiFile,
  source: TempoSource = "all",
): TempoPoint[] {
  const points: TempoPoint[] = [];

  const pushFromTrack = (track: MidiTrack) => {
    let abs = 0;
    for (const ev of track.events) {
      abs += ev.delta;
      if (ev.type === "meta" && ev.metaType === 0x51 && ev.tempoUsPerQuarter) {
        points.push({ tick: abs, usPerQuarter: ev.tempoUsPerQuarter });
      }
    }
  };

  if (midi.format === 1) {
    if (source === "track0") {
      if (midi.tracks[0]) pushFromTrack(midi.tracks[0]);
    } else if (source === "all" || source === "merge") {
      for (const t of midi.tracks) pushFromTrack(t);
    }
  } else if (midi.format === 0) {
    for (const t of midi.tracks) pushFromTrack(t);
  } else if (midi.format === 2) {
    // Format2: each track is independent, use track0 for global tempo
    if (midi.tracks[0]) pushFromTrack(midi.tracks[0]);
  }

  // Sort by tick first
  points.sort((a, b) => a.tick - b.tick);

  // Merge same-tick points (later wins)
  const out: TempoPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.tick === p.tick) {
      last.usPerQuarter = p.usPerQuarter;
    } else {
      out.push({ ...p });
    }
  }

  // Add default tempo at tick 0 if no tempo event exists there
  if (out.length === 0 || (out[0] && out[0].tick !== 0)) {
    out.unshift({ tick: 0, usPerQuarter: 500000 });
  }

  return out;
}

export function ticksToMs(
  tick: number,
  tempoMap: TempoPoint[],
  ppqOrMidi: number | MidiFile,
): number {
  if (typeof ppqOrMidi !== "number") {
    const midi = ppqOrMidi as MidiFile;
    if (midi.smpte) {
      const fps = midi.smpte.fps;
      const tpf = midi.smpte.ticksPerFrame;
      if (fps <= 0 || tpf <= 0)
        throw new Error("Invalid SMPTE division parameters");
      const seconds = tick / (fps * tpf);
      return seconds * 1000;
    }
    if (!midi.ticksPerQuarter) {
      throw new Error("PPQ not present in MIDI header");
    }
    return ticksToMs_PPQ(tick, tempoMap, midi.ticksPerQuarter);
  } else {
    return ticksToMs_PPQ(tick, tempoMap, ppqOrMidi);
  }
}

function ticksToMs_PPQ(
  tick: number,
  tempoMap: TempoPoint[],
  ppq: number,
): number {
  if (ppq <= 0) throw new Error("PPQ must be > 0");
  if (tempoMap.length === 0) throw new Error("Tempo map is empty");

  let totalMs = 0;
  let cursorTick = 0;

  for (let i = 0; i < tempoMap.length; i++) {
    const cur = tempoMap[i];
    if (!cur) continue;
    const next = tempoMap[i + 1] ?? null;

    const segStart = Math.max(cursorTick, cur.tick);
    const segEnd = next ? Math.min(next.tick, tick) : tick;

    if (segEnd > segStart && segStart < tick) {
      const ticks = segEnd - segStart;
      totalMs += (ticks * cur.usPerQuarter) / (ppq * 1000);
      cursorTick = segEnd;
    }

    if (cursorTick >= tick) break;
  }

  return totalMs;
}
