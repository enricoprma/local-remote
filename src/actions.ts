export type RemoteAction =
  | "click"
  | "enter"
  | "back"
  | "volume-up"
  | "volume-down";

type InputKey =
  | "enter"
  | "escape"
  | "audio_vol_up"
  | "audio_vol_down";

type KeyboardAction = Exclude<RemoteAction, "click">;

const inputKeys: Record<KeyboardAction, InputKey> = {
  enter: "enter",
  back: "escape",
  "volume-up": "audio_vol_up",
  "volume-down": "audio_vol_down",
};

const remoteActions: Record<RemoteAction, true> = {
  click: true,
  enter: true,
  back: true,
  "volume-up": true,
  "volume-down": true,
};

export function isRemoteAction(value: unknown): value is RemoteAction {
  return typeof value === "string" && Object.hasOwn(remoteActions, value);
}

export function getInputKey(action: KeyboardAction): InputKey {
  return inputKeys[action];
}
