import robot from "@hurdlegroup/robotjs";

import type { Input } from "./input";
import type { RemoteAction } from "./actions";

// These native names stay internal; the HTTP API exposes only RemoteAction values.
const robotKeys = {
    enter: "enter",
    back: "escape",
    "volume-up": "audio_vol_up",
    "volume-down": "audio_vol_down",
    "left": "left",
    "right": "right",
} satisfies Record<Exclude<RemoteAction, "click" | "right-click" | "start-drag" | "end-drag">, string>;

// A disconnected browser cannot send pointerUp. No heartbeat is required:
// release after 15 seconds without drag movement, including a stationary hold.
export const pointerIdleTimeoutMs = 15_000;
let pointerIsDown = false;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRelease(delay = pointerIdleTimeoutMs): void {
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(releasePointerSafely, delay);
    releaseTimer.unref();
}

function pointerDown(): void {
    if (pointerIsDown) return;

    // Record the attempted press before calling native code, so an error
    // after a partial native operation still gets a matching release.
    pointerIsDown = true;
    scheduleRelease();
    try {
        robot.mouseToggle("down", "left");
    } catch (error) {
        releasePointerSafely();
        throw error;
    }
}

function pointerUp(): void {
    if (!pointerIsDown) return;

    try {
        robot.mouseToggle("up", "left");
    } catch (error) {
        // Retain the held state so a failed native release can be retried.
        scheduleRelease(1000);
        throw error;
    }

    pointerIsDown = false;
    if (releaseTimer !== null) clearTimeout(releaseTimer);
    releaseTimer = null;
}

function releasePointerSafely(): void {
    try {
        pointerUp();
    } catch (error) {
        console.error("[input] Pointer release failed:", error);
    }
}


export const robotJsInput: Input = {

    executeAction(action: RemoteAction): void {
        if (action === "click" || action === "right-click") {
            // A discrete click ends any held input before toggling buttons.
            pointerUp();
            robot.mouseClick(action === "click" ? "left" : "right");
            return;
        }
        if (action === "start-drag" || action === "end-drag") {
            action === "start-drag" ? pointerDown() : pointerUp();
            return;
        }

        robot.keyTap(robotKeys[action]);
    },

    movePointer(dx: number, dy: number): void {
        try {
            const position = robot.getMousePos();
            if (pointerIsDown) {
                robot.dragMouse(position.x + dx, position.y + dy);
                scheduleRelease();
            } else {
                robot.moveMouse(position.x + dx, position.y + dy);
            }
        } catch (error) {
            releasePointerSafely();
            throw error;
        }
    },

    scroll(dy: number): void {
        robot.scrollMouse(0, dy);
    },

    typeText(text: string): void {
        robot.typeString(text);
    }
}
