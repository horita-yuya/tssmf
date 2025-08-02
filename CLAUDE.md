# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a zero-dependency TypeScript library for parsing MIDI files. The library is written in pure ECMAScript and has strict TypeScript configuration enabled.

## Commands

### Development
- `pnpm test` - Run all tests once
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- `pnpm typecheck` - Run TypeScript type checking

### Testing a Single Test
- `pnpm test <test-file-pattern>` - Run tests matching the pattern
- Example: `pnpm test midi.test` to run midi.test.ts

## Architecture

### Core Module Structure
The library consists of a single main module (`src/midi.ts`) that exports:
- **parseMidi()** - Main parsing function that takes ArrayBuffer/Uint8Array and returns MidiFile
- **buildTempoMap()** - Builds tempo map from parsed MIDI for timing calculations
- **ticksToMs()** - Converts MIDI ticks to milliseconds using tempo map

### Type System
The library uses discriminated unions for event types:
- **MidiEvent** - Union of ChannelEvent | MetaEvent | SysExEvent
- **ChannelEvent** - Note on/off, control changes, etc. with specific subtypes
- **MetaEvent** - Tempo, time signature, text events with convenience fields
- **SysExEvent** - System exclusive messages

### Parser Implementation
- **MidiParser** class - Internal parser with DataView for binary reading
- Handles variable-length quantities (VLQ) for delta times and meta event lengths
- Supports running status for channel events
- Validates MIDI file structure during parsing

### Testing Strategy
- Unit tests in `src/__tests__/` using Vitest
- Test utilities in `test-utils.ts` for creating test MIDI data
- Coverage requirements: 90% statements, 85% branches
- Tests cover error cases, edge cases, and integration scenarios