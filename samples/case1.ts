// samples/case1.ts (ESM/TS で動く版)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { parseMidi } from "../src/midi.ts"; // ← TSを直接実行するなら拡張子必須

// __dirname を自前で定義（ESM流儀）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
  const midiPath = path.resolve(__dirname, "case1.mid");
  const midiFile = readFileSync(midiPath);
  const parsed = parseMidi(midiFile);
  console.log(parsed.ticksPerQuarter);
  for (const track of parsed.tracks) {
    for (const event of track.events) {
      console.log(event)
    }
  }
}

main();
