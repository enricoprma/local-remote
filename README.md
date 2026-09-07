# Local Remote

Use your phone as a wireless touchpad and keyboard for your Windows PC over your local network.

No mobile app required.

<p align="start">
  <img src="assets/screenshots/touchpad.jpeg" width="280" alt="Local Remote touchpad">
  <img src="assets/screenshots/keyboard.jpeg" width="280" alt="Local Remote keyboard input">
</p>


## Usage

1. Download the [latest release](https://github.com/enricoprma/local-remote/releases/latest).
2. Start **Local Remote** on your PC.
3. Click the tray icon.
4. Scan the QR code with your phone.

Alternatively, open:

```text
http://local-remote.local:3000
```

Your PC and phone must be connected to the same network.

On iPhone, you can add Local Remote to your Home Screen from Safari and use it like a standalone app.

### Controls

* **Move** - drag with one finger
* **Click** - tap
* **Scroll** - drag with two fingers
* **Keyboard** - long press
* **Volume** - use the buttons below the touchpad

### Administrator applications

Windows blocks simulated input from lower-privileged applications.

If you want to control an application that is running as administrator, start **Local Remote as administrator as well**.

## Build from source

Requires:

* Node.js
* Python
* Visual Studio Build Tools with **Desktop development with C++**

The C++ build tools are required to compile the native RobotJS dependency on Windows.

```bash
git clone https://github.com/enricoprma/local-remote.git
cd local-remote
npm install
npm run dist
```

The portable Windows build is created in `release/`.

> Local Remote has no authentication. Only use it on networks you trust.