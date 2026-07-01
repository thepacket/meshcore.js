/**
 * Companion Radio Protocol constants.
 *
 * Values taken verbatim from MeshCore `examples/companion_radio/MyMesh.cpp`
 * and `src/helpers/AdvertDataHelpers.h` / `TxtDataHelpers.h`.
 */

/** Commands: app -> device. */
export const Cmd = {
  APP_START: 1,
  SEND_TXT_MSG: 2,
  SEND_CHANNEL_TXT_MSG: 3,
  GET_CONTACTS: 4,
  GET_DEVICE_TIME: 5,
  SET_DEVICE_TIME: 6,
  SEND_SELF_ADVERT: 7,
  SET_ADVERT_NAME: 8,
  ADD_UPDATE_CONTACT: 9,
  SYNC_NEXT_MESSAGE: 10,
  SET_RADIO_PARAMS: 11,
  SET_RADIO_TX_POWER: 12,
  RESET_PATH: 13,
  SET_ADVERT_LATLON: 14,
  REMOVE_CONTACT: 15,
  SHARE_CONTACT: 16,
  EXPORT_CONTACT: 17,
  IMPORT_CONTACT: 18,
  REBOOT: 19,
  GET_BATT_AND_STORAGE: 20,
  SET_TUNING_PARAMS: 21,
  DEVICE_QUERY: 22,
  EXPORT_PRIVATE_KEY: 23,
  IMPORT_PRIVATE_KEY: 24,
  SEND_RAW_DATA: 25,
  SEND_LOGIN: 26,
  SEND_STATUS_REQ: 27,
  HAS_CONNECTION: 28,
  LOGOUT: 29,
  GET_CONTACT_BY_KEY: 30,
  GET_CHANNEL: 31,
  SET_CHANNEL: 32,
  SIGN_START: 33,
  SIGN_DATA: 34,
  SIGN_FINISH: 35,
  SEND_TRACE_PATH: 36,
  SET_DEVICE_PIN: 37,
  SET_OTHER_PARAMS: 38,
  SEND_TELEMETRY_REQ: 39,
  GET_CUSTOM_VARS: 40,
  SET_CUSTOM_VAR: 41,
  GET_ADVERT_PATH: 42,
  GET_TUNING_PARAMS: 43,
  SEND_BINARY_REQ: 50,
  FACTORY_RESET: 51,
  SEND_PATH_DISCOVERY_REQ: 52,
  SET_FLOOD_SCOPE_KEY: 54,
  SEND_CONTROL_DATA: 55,
  GET_STATS: 56,
  SEND_ANON_REQ: 57,
  SET_AUTOADD_CONFIG: 58,
  GET_AUTOADD_CONFIG: 59,
  GET_ALLOWED_REPEAT_FREQ: 60,
  SET_PATH_HASH_MODE: 61,
  SEND_CHANNEL_DATA: 62,
  SET_DEFAULT_FLOOD_SCOPE: 63,
  GET_DEFAULT_FLOOD_SCOPE: 64,
  SEND_RAW_PACKET: 65,
} as const;

/** Responses: device -> app (solicited). */
export const Resp = {
  OK: 0,
  ERR: 1,
  CONTACTS_START: 2,
  CONTACT: 3,
  END_OF_CONTACTS: 4,
  SELF_INFO: 5,
  SENT: 6,
  CONTACT_MSG_RECV: 7,
  CHANNEL_MSG_RECV: 8,
  CURR_TIME: 9,
  NO_MORE_MESSAGES: 10,
  EXPORT_CONTACT: 11,
  BATT_AND_STORAGE: 12,
  DEVICE_INFO: 13,
  PRIVATE_KEY: 14,
  DISABLED: 15,
  CONTACT_MSG_RECV_V3: 16,
  CHANNEL_MSG_RECV_V3: 17,
  CHANNEL_INFO: 18,
  SIGN_START: 19,
  SIGNATURE: 20,
  CUSTOM_VARS: 21,
  ADVERT_PATH: 22,
  TUNING_PARAMS: 23,
  STATS: 24,
  AUTOADD_CONFIG: 25,
  ALLOWED_REPEAT_FREQ: 26,
  CHANNEL_DATA_RECV: 27,
  DEFAULT_FLOOD_SCOPE: 28,
} as const;

/** Push notifications: device -> app (unsolicited). All have the high bit set. */
export const Push = {
  ADVERT: 0x80,
  PATH_UPDATED: 0x81,
  SEND_CONFIRMED: 0x82,
  MSG_WAITING: 0x83,
  RAW_DATA: 0x84,
  LOGIN_SUCCESS: 0x85,
  LOGIN_FAIL: 0x86,
  STATUS_RESPONSE: 0x87,
  LOG_RX_DATA: 0x88,
  TRACE_DATA: 0x89,
  NEW_ADVERT: 0x8a,
  TELEMETRY_RESPONSE: 0x8b,
  BINARY_RESPONSE: 0x8c,
  PATH_DISCOVERY_RESPONSE: 0x8d,
  CONTROL_DATA: 0x8e,
  CONTACT_DELETED: 0x8f,
  CONTACTS_FULL: 0x90,
} as const;

/** A frame code >= 0x80 is an unsolicited push. */
export const PUSH_CODE_MIN = 0x80;

/** Advertisement / contact types. */
export const AdvType = {
  NONE: 0,
  CHAT: 1,
  REPEATER: 2,
  ROOM: 3,
  SENSOR: 4,
} as const;

/** Stats sub-types for CMD.GET_STATS. */
export const StatsType = {
  CORE: 0,
  RADIO: 1,
  PACKETS: 2,
} as const;

/** Text message types. */
export const TxtType = {
  PLAIN: 0,
  CLI_DATA: 1,
  SIGNED_PLAIN: 2,
} as const;

/** Error codes carried by RESP.ERR. */
export const ErrCode = {
  UNSUPPORTED_CMD: 1,
  NOT_FOUND: 2,
  TABLE_FULL: 3,
  BAD_STATE: 4,
  FILE_IO_ERROR: 5,
  ILLEGAL_ARG: 6,
} as const;

export const ERR_CODE_NAMES: Record<number, string> = {
  1: 'UNSUPPORTED_CMD',
  2: 'NOT_FOUND',
  3: 'TABLE_FULL',
  4: 'BAD_STATE',
  5: 'FILE_IO_ERROR',
  6: 'ILLEGAL_ARG',
};

/** Base64 PSK of the built-in "public" group channel. */
export const PUBLIC_GROUP_PSK = 'izOH6cXN6mrJ5e26oRXNcg==';

/** Field sizes shared with the firmware. */
export const PUB_KEY_SIZE = 32;
export const MAX_PATH_SIZE = 64;
export const CONTACT_NAME_SIZE = 32;
export const CHANNEL_NAME_SIZE = 32;
/** Group-channel shared secret: 128-bit (only size the firmware supports). */
export const CHANNEL_SECRET_SIZE = 16;
/** Direct messages/adverts carry a 6-byte public-key prefix on the wire. */
export const PUBKEY_PREFIX_SIZE = 6;
/** Sentinel path_len meaning "unknown / flood". */
export const OUT_PATH_UNKNOWN = 0xff;
