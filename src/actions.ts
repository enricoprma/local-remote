// The allowlist is the single source for runtime validation and the action type.
const remoteActions = {
  click: true,
  enter: true,
  back: true,
  "volume-up": true,
  "volume-down": true,
};

export type RemoteAction = keyof typeof remoteActions;

export function isRemoteAction(value: unknown): value is RemoteAction {
  // hasOwn also rejects inherited property names such as "toString".
  return typeof value === "string" && Object.hasOwn(remoteActions, value);
}
