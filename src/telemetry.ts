/**
 * Telemetry (CayenneLPP) parsing.
 *
 * MeshCore telemetry blobs (from `requestTelemetry` / `getSelfTelemetry`) use a
 * Cayenne Low Power Payload layout, mirroring `LPPDataHelpers.h` in the
 * firmware. Each entry is `[channel(1), type(1), data(N)]`; a channel of 0 marks
 * end-of-data. Unlike the Companion Protocol, LPP values are **big-endian**, and
 * signed values are two's complement.
 */

/** LPP data-type identifiers (subset present in MeshCore). */
export const LppType = {
  DIGITAL_INPUT: 0,
  DIGITAL_OUTPUT: 1,
  ANALOG_INPUT: 2,
  ANALOG_OUTPUT: 3,
  GENERIC_SENSOR: 100,
  LUMINOSITY: 101,
  PRESENCE: 102,
  TEMPERATURE: 103,
  RELATIVE_HUMIDITY: 104,
  ACCELEROMETER: 113,
  BAROMETRIC_PRESSURE: 115,
  VOLTAGE: 116,
  CURRENT: 117,
  FREQUENCY: 118,
  PERCENTAGE: 120,
  ALTITUDE: 121,
  CONCENTRATION: 125,
  POWER: 128,
  DISTANCE: 130,
  ENERGY: 131,
  DIRECTION: 132,
  UNIXTIME: 133,
  GYROMETER: 134,
  COLOUR: 135,
  GPS: 136,
  SWITCH: 142,
} as const;

export interface GpsReading {
  lat: number;
  lon: number;
  alt: number;
}

export interface TelemetryReading {
  /** LPP channel (sensor index within the node). */
  channel: number;
  /** LPP data type (one of {@link LppType}). */
  type: number;
  /** Human-readable type name. */
  typeName: string;
  /** Unit string, if applicable (e.g. "°C", "V"). */
  unit: string;
  /** Scalar value (for multi-component readings, the first component). */
  value: number;
  /** Components for multi-axis (accelerometer/gyrometer) or colour (r,g,b). */
  values?: number[];
  /** Present for GPS readings. */
  gps?: GpsReading;
}

interface ScalarSpec {
  name: string;
  size: number;
  mult: number;
  signed: boolean;
  unit: string;
}

// Per-type size/multiplier/sign, matching the LPPReader readers and the type
// table in LPPDataHelpers.h.
const SCALAR: Record<number, ScalarSpec> = {
  [LppType.DIGITAL_INPUT]: { name: 'digital_input', size: 1, mult: 1, signed: false, unit: '' },
  [LppType.DIGITAL_OUTPUT]: { name: 'digital_output', size: 1, mult: 1, signed: false, unit: '' },
  [LppType.ANALOG_INPUT]: { name: 'analog_input', size: 2, mult: 100, signed: true, unit: '' },
  [LppType.ANALOG_OUTPUT]: { name: 'analog_output', size: 2, mult: 100, signed: true, unit: '' },
  [LppType.GENERIC_SENSOR]: { name: 'generic', size: 4, mult: 1, signed: false, unit: '' },
  [LppType.LUMINOSITY]: { name: 'luminosity', size: 2, mult: 1, signed: false, unit: 'lux' },
  [LppType.PRESENCE]: { name: 'presence', size: 1, mult: 1, signed: false, unit: '' },
  [LppType.TEMPERATURE]: { name: 'temperature', size: 2, mult: 10, signed: true, unit: '°C' },
  [LppType.RELATIVE_HUMIDITY]: { name: 'humidity', size: 1, mult: 2, signed: false, unit: '%' },
  [LppType.BAROMETRIC_PRESSURE]: { name: 'pressure', size: 2, mult: 10, signed: false, unit: 'hPa' },
  [LppType.VOLTAGE]: { name: 'voltage', size: 2, mult: 100, signed: false, unit: 'V' },
  [LppType.CURRENT]: { name: 'current', size: 2, mult: 1000, signed: true, unit: 'A' },
  [LppType.FREQUENCY]: { name: 'frequency', size: 4, mult: 1, signed: false, unit: 'Hz' },
  [LppType.PERCENTAGE]: { name: 'percentage', size: 1, mult: 1, signed: false, unit: '%' },
  [LppType.ALTITUDE]: { name: 'altitude', size: 2, mult: 1, signed: true, unit: 'm' },
  [LppType.CONCENTRATION]: { name: 'concentration', size: 2, mult: 1, signed: false, unit: 'ppm' },
  [LppType.POWER]: { name: 'power', size: 2, mult: 1, signed: false, unit: 'W' },
  [LppType.DISTANCE]: { name: 'distance', size: 4, mult: 1000, signed: false, unit: 'm' },
  [LppType.ENERGY]: { name: 'energy', size: 4, mult: 1000, signed: false, unit: 'kWh' },
  [LppType.DIRECTION]: { name: 'direction', size: 2, mult: 1, signed: false, unit: '°' },
  [LppType.UNIXTIME]: { name: 'unixtime', size: 4, mult: 1, signed: false, unit: 's' },
  [LppType.SWITCH]: { name: 'switch', size: 1, mult: 1, signed: false, unit: '' },
};

/** Read a big-endian integer and scale it, applying two's-complement sign. */
function getFloat(
  buf: Uint8Array,
  off: number,
  size: number,
  mult: number,
  signed: boolean,
): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + buf[off + i]!;
  if (signed) {
    const max = 2 ** (size * 8);
    if (value >= max / 2) value -= max;
  }
  return value / mult;
}

/**
 * Parse a CayenneLPP telemetry blob into structured readings. Stops cleanly at
 * end-of-data, a truncated entry, or an unrecognised type (whose length is
 * unknown and can't be safely skipped).
 */
export function parseTelemetry(data: Uint8Array): TelemetryReading[] {
  const out: TelemetryReading[] = [];
  let pos = 0;

  while (pos + 2 <= data.length) {
    const channel = data[pos]!;
    if (channel === 0) break; // end-of-data marker
    const type = data[pos + 1]!;
    pos += 2;

    const scalar = SCALAR[type];
    if (scalar) {
      if (pos + scalar.size > data.length) break;
      out.push({
        channel,
        type,
        typeName: scalar.name,
        unit: scalar.unit,
        value: getFloat(data, pos, scalar.size, scalar.mult, scalar.signed),
      });
      pos += scalar.size;
      continue;
    }

    if (type === LppType.ACCELEROMETER || type === LppType.GYROMETER) {
      if (pos + 6 > data.length) break;
      const mult = type === LppType.ACCELEROMETER ? 1000 : 100;
      const values = [
        getFloat(data, pos, 2, mult, true),
        getFloat(data, pos + 2, 2, mult, true),
        getFloat(data, pos + 4, 2, mult, true),
      ];
      out.push({
        channel,
        type,
        typeName: type === LppType.ACCELEROMETER ? 'accelerometer' : 'gyrometer',
        unit: type === LppType.ACCELEROMETER ? 'G' : '°/s',
        value: values[0]!,
        values,
      });
      pos += 6;
      continue;
    }

    if (type === LppType.COLOUR) {
      if (pos + 3 > data.length) break;
      const values = [data[pos]!, data[pos + 1]!, data[pos + 2]!];
      out.push({ channel, type, typeName: 'colour', unit: '', value: values[0]!, values });
      pos += 3;
      continue;
    }

    if (type === LppType.GPS) {
      if (pos + 9 > data.length) break;
      const gps: GpsReading = {
        lat: getFloat(data, pos, 3, 10000, true),
        lon: getFloat(data, pos + 3, 3, 10000, true),
        alt: getFloat(data, pos + 6, 3, 100, true),
      };
      out.push({ channel, type, typeName: 'gps', unit: '', value: gps.lat, gps });
      pos += 9;
      continue;
    }

    break; // unknown type: length unknown, stop to avoid misalignment
  }

  return out;
}
