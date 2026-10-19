// Stellvertreter für src/room.js in test/tisch.test.js – die Tischhöhe kommt aus der echten Datei
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/room.js', import.meta.url), 'utf8');
export const TABLE_TOP = Number(src.match(/export const TABLE_TOP = ([\d.]+)/)[1]);
