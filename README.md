# WheelHost

**Turn any phone or tablet into a tilt-steering wheel controller for your Windows games — no
extra hardware, no app store, just a browser.** Point it at Forza and drive with real analog
tilt steering plus a fully customizable set of paddles, pedals, and a handbrake — like building
your own F1-style wheel out of the device already in your hand.

- **WheelHost** is a Windows desktop app. It emulates a real virtual Xbox 360 controller, so
  every Windows game sees it exactly like a genuine gamepad — no per-game setup required.
- The **companion web app** runs in any mobile browser (tested on Safari/iPad) — nothing to
  install on the controller device. Open a link, type a code, start driving.
- Everything runs over your **home Wi-Fi only** — no internet connection, no account, no cloud
  relay, no data leaving your network. Just your PC and your device talking directly.

## How joining works

```
   Windows PC                              Phone / Tablet
 ┌───────────────┐                        ┌───────────────┐
 │   WheelHost    │   1. Shows a 6-digit  │  Open browser  │
 │  (Start Server)│──────  code + QR ────▶│   at the URL   │
 └───────────────┘                        └───────┬───────┘
         ▲                                          │ 2. Scan QR or
         │ 4. Tilt + button                         │    type the code
         │    events, live                          ▼
         │                                  ┌───────────────┐
         └───────── same Wi-Fi ─────────────│  Wheel screen  │
           3. Code accepted, device paired  │ tilt to steer  │
                                             └───────────────┘
```

1. On the PC, open WheelHost and click **Start Server**. A 6-digit join code and a QR code
   appear.
2. On the phone/tablet — connected to that **same Wi-Fi network** — scan the QR code (it opens
   straight to the join screen with the code already filled in) or type the code by hand.
3. The moment the code matches, the two devices are paired directly over the LAN — nothing
   goes through the internet.
4. The phone becomes the wheel: tilt to steer, tap the on-screen paddles/pedals/handbrake, and
   WheelHost feeds every input into a virtual Xbox controller that Windows and your game see as
   a normal gamepad, in real time.

Only one device can be the active controller at a time — it's a single-player wheel — so a
second join attempt is politely rejected until the first disconnects.

## Download

> **[Download the latest WheelHost-Setup.exe](https://github.com/<your-username>/<your-repo>/releases/latest)**
> *(replace `<your-username>/<your-repo>` once this is pushed to your own GitHub repo — see
> [Releasing a new version](#releasing-a-new-version) below)*

Run the installer, click through the wizard, done. It installs WheelHost to your Start Menu,
adds an uninstaller, and — if it's not already on your system — silently installs the
[ViGEmBus](https://github.com/ViGEm/ViGEmBus) driver that lets Windows see the virtual
controller. No separate downloads, no manual driver install, no .NET SDK required.

On first launch, Windows Firewall will ask to allow WheelHost network access — **allow it on
Private networks** (this is what lets your phone/tablet reach it over Wi-Fi).

## Using it

1. Launch WheelHost, click **Start Server**. It shows a 6-digit join code, a QR code, and the
   LAN address it's listening on (e.g. `http://192.168.1.23:7890`).
2. On your iPad/phone, make sure it's on **the same Wi-Fi network** as the PC (not a guest
   network, not cellular data).
3. Scan the QR code with your camera (it opens straight to the join screen with the code
   filled in), or open the address manually and type the code into the 6-digit entry.
4. Tap **Enable Motion & Start**, grant the sensor permission prompt.
5. Hold the device landscape, like a wheel. Tilt to steer; tap the paddles/pedals/handbrake
   for the rest. Tap **Calibrate center** (or 3-finger-tap anywhere) to re-zero if "straight
   ahead" drifts.
6. Tap the gear icon to remap any on-screen control to a different action, or adjust steering
   sensitivity. Your layout is saved on the device for next time.

In WheelHost, the **Button Mapping** panel lets you change which Xbox controller
button/trigger each logical action (Accelerate, Brake, Gear Up/Down, Handbrake, Extra 1/2)
drives — useful if a game's default control scheme doesn't match the sensible defaults below.

**Default mapping**: Accelerate → Right Trigger · Brake → Left Trigger · Gear Up → Right
Shoulder (RB) · Gear Down → Left Shoulder (LB) · Handbrake → A · Extra 1 → X · Extra 2 → Y.
Steering always drives the left stick's X axis.

Only one device can be connected as the controller at a time (it's a single-player wheel) —
connecting a second device while one is active will be rejected until the first disconnects.

## Manual test plan

1. Start WheelHost — confirm the join code, QR code, and LAN address all populate, and the
   **Live Input** steering bar sits centered with no chips lit.
2. From a phone/tablet on the same Wi-Fi, scan the QR / enter the code, grant motion
   permission, and confirm the on-screen wheel visually rotates the same direction you
   physically tilt the device. If it's inverted, that's worth flagging — see the note below.
3. Watch WheelHost's **Live Input** panel while tapping each on-screen button — the matching
   chip (Accel/Brake/Gear+/Gear-/H-Brake/Extra 1/Extra 2) should light up on press and clear
   on release, and the steering bar should track tilt smoothly.
4. Open Windows' **Set up USB game controllers** (`joy.cpl`) — a virtual Xbox 360 Controller
   should be listed. Open Properties → Test and confirm the X axis and buttons respond the
   same way.
5. Launch Forza → Options → Controls, confirm the virtual controller is recognized (select it
   explicitly if a real gamepad is also plugged in), then test-drive: steering, throttle,
   brake, gear up/down, and handbrake should all behave as expected once mapped.
6. Background the browser tab or lock the phone mid-turn — WheelHost has a watchdog that
   centers steering and releases all buttons if no input arrives for ~1.5s, specifically so a
   dropped connection can't leave the car stuck mid-turn in-game. Confirm the car straightens
   out rather than staying locked over.

## Known things worth verifying on real hardware

I built and wired this up without a Windows machine or the physical devices on hand, so two
spots are worth double-checking the first time you run it — nothing structural, just exactly
the kind of thing that only shows up on real hardware/SDKs:

- **Tilt direction** (`wwwroot/js/motion.js`): the sign of the steering value is derived from
  `screen.orientation.angle` to handle both landscape rotations consistently. If steering
  comes out inverted on your device, flip the sign in `_handler()`'s `angle === 90` /
  `angle === -90` branches.
- **ViGEm API surface** (`Services/VirtualControllerService.cs`): written against the
  `Nefarius.ViGEm.Client` API as documented (`Xbox360Button`/`Xbox360Axis`/`Xbox360Slider`
  static members, `CreateXbox360Controller()`, `VigemBusNotFoundException`). If `dotnet build`
  reports a member/type not found here, it's almost certainly just a naming difference in the
  installed package version — the fix is a one-line rename, not a design change.

---

## For developers

### Build & run from source

```powershell
cd host/WheelHost
dotnet run
```

Requires the [.NET 8 SDK](https://dotnet.microsoft.com/download) and, for the virtual
controller to work, the [ViGEmBus driver](https://github.com/ViGEm/ViGEmBus/releases)
installed manually (the installer normally does this for you — see below).

No admin elevation is needed to run WheelHost itself; the app talks raw TCP sockets rather
than `HttpListener`, specifically so it never needs to run as Administrator.

### Releasing a new version

The installer is built entirely by CI — you never need Inno Setup or Windows locally to cut a
release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Pushing a `v*.*.*` tag triggers `.github/workflows/release.yml`, which:

1. Publishes a self-contained `win-x64` build (bundles the .NET runtime — end users don't
   install anything separately).
2. Downloads the latest ViGEmBus installer straight from its GitHub releases and bundles it.
3. Compiles `installer/WheelHost.iss` with [Inno Setup](https://jrsoftware.org/isinfo.php) into
   `WheelHost-Setup.exe`.
4. Publishes a GitHub Release for the tag with that installer attached.

To test the installer build locally on Windows without pushing a tag: install Inno Setup, run
`dotnet publish host/WheelHost/WheelHost.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish`,
then `ISCC installer\WheelHost.iss` (the ViGEmBus-bundling step is skipped automatically if
`installer/redist/ViGEmBusSetup_x64.exe` isn't present).

### Project layout

```
host/WheelHost/
  WheelHost.csproj          # net8.0-windows WPF app
  App.xaml(.cs)              # startup
  MainWindow.xaml(.cs)        # host UI: join code/QR, device status, live input, mapping editor
  Models/                     # ButtonAction, Xbox360Element, ControllerMapping, AppSettings, ...
  Services/
    VirtualControllerService.cs  # ViGEm virtual Xbox 360 controller wrapper
    GameServer.cs                 # hand-rolled HTTP + WebSocket server (raw TCP, no admin needed)
    NetworkHelper.cs              # LAN IP discovery
    JoinCodeGenerator.cs
    QrCodeService.cs
    SettingsStore.cs              # persists mapping/port to %AppData%\WheelHost\settings.json
  Themes/DarkTheme.xaml       # WPF dark theme resources
  wwwroot/                    # the web client, served directly by GameServer
    index.html
    manifest.json              # PWA manifest (Add to Home Screen support)
    css/style.css
    js/{ws,motion,wheel-ui,app}.js
    assets/                     # app icons (icon.ico, favicons, apple-touch-icon)

installer/
  WheelHost.iss              # Inno Setup script (see "Releasing a new version" above)
  redist/                    # ViGEmBus installer is downloaded here at CI build time

.github/workflows/release.yml  # tag-triggered build + installer + GitHub Release
```

## License

[MIT](LICENSE)
