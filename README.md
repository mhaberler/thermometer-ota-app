# Thermometer OTA

A phone app for the [bt_soc_thermometer_mock](https://github.com/mhaberler/bt_soc_thermometer_mock) firmware (Silicon Labs BGM220, Bluetooth LE). It

- scans for the thermometer,
- connects and shows the temperature and the firmware version,
- checks the firmware repository for a newer release and offers it,
- updates the firmware over Bluetooth (OTA), from a release or from any URL.

Built with Capacitor 8, Vue 3, TypeScript, Pinia and [@capacitor-community/bluetooth-le](https://github.com/capacitor-community/bluetooth-le). Runs on Android and iOS.

**Status:** working. Scanning, reading and the firmware update have been verified on hardware with Android and iOS. The app is signed and released for both platforms.

## How it relates to the firmware

The firmware repository holds the device side: the thermometer application, the in-place OTA setup with the Silicon Labs Apploader bootloader, and a workflow that publishes a GBL image for every `vX.Y.Z` tag. Its [OTA.md](https://github.com/mhaberler/bt_soc_thermometer_mock/blob/main/OTA.md) describes flash layout, bootloader and release procedure.

What this app relies on:

| Device feature | UUID | Use |
|----------------|------|-----|
| Health Thermometer service | `1809` | Found in the advertisement; identifies the thermometer |
| Temperature Measurement | `2A1C` | Indications, one per second |
| Firmware Revision String | `2A26` | Running firmware version, e.g. `1.0.1` |
| Silicon Labs OTA service | `1D14D6EE-FD63-4FA1-BFA4-8F47B42119F0` | Firmware update |
| OTA Control | `F7BF3564-FB6D-4E53-88A4-5E37E0326063` | Start and end of an update |
| OTA Data | `984227F3-34FC-4045-A5D0-2C581F81A153` | Image upload (only present in update mode) |

Firmware releases come from `https://api.github.com/repos/mhaberler/bt_soc_thermometer_mock/releases/latest`. The repository name is the constant `FIRMWARE_REPO` in [src/lib/release.ts](src/lib/release.ts).

## Using the app

1. **Scan.** Thermometers in range are listed. A device that was left in update mode by an interrupted update is listed too, marked "update mode".
2. **Tap a device.** The app connects and shows temperature and firmware version.
3. **Firmware update.** One of:
   - "Update to X.Y.Z available": a newer release exists. Tap the button; the app downloads the image and runs the update.
   - "Firmware is up to date": the device runs the latest release or something newer.
   - "From URL": enter the address of any `.gbl` file, tap Download, then Update device. Useful for images that are not released, or to go back to an older version.
4. After the update the app reconnects and shows the new version next to the old one.

Keep the app open and in the foreground during an update. It takes a minute or more.

### When is a release "newer"?

Versions are compared as `MAJOR.MINOR.PATCH` numbers. If the device reports something that is not of this form (for example `v4` from an early test image), it counts as older and the update is offered. A device in update mode has no running firmware, so the latest release is always offered.

### What happens during an update

1. The app writes `0x00` to OTA Control. The firmware reboots into the Apploader, which advertises as `OTA`.
2. The app scans for the Apploader, connects, and writes `0x00` to OTA Control again.
3. It writes the GBL image to OTA Data in chunks (write with response, chunk size from the negotiated MTU).
4. It writes `0x03` to OTA Control and disconnects. The Apploader installs the image and starts it.
5. The app scans for the thermometer and reconnects.

If the update is interrupted, the device stays in update mode and has no working application. Scan again, tap the device marked "update mode", and repeat the update.

## Project layout

```
src/
  App.vue                 single screen: scan, device, firmware update
  stores/thermometer.ts   app state and actions (Pinia)
  lib/
    uuids.ts              service and characteristic UUIDs
    ble.ts                Bluetooth plugin glue, scan classification
    ota.ts                update procedure, independent of the Bluetooth plugin
    temperature.ts        decodes the temperature measurement (IEEE 11073 float)
    gbl.ts                checks that a download is a GBL file
    download.ts           fetches a GBL file with native HTTP
    release.ts            looks up the latest firmware release on GitHub
    version.ts            version parsing and comparison
    lib.test.ts           unit tests
android/, ios/            native projects (Capacitor)
ci/                       iOS export options used by the release workflow
scripts/                  sync-app-secrets.sh
.github/workflows/        app-release.yml
```

## Building

### Requirements

- [Bun](https://bun.sh)
- Android: Android Studio with SDK, JDK 21
- iOS: macOS with Xcode
- A device with the firmware, and a real phone. Simulators and emulators have no Bluetooth.

### Web part and tests

```sh
bun install
bun run test          # unit tests
bun run typecheck     # type check only
bun run build-prod    # type check and build into dist/
```

`bun run dev` serves the web part in a browser. That is only good for layout work: Bluetooth needs the native app.

### Running on a phone

After every change to the web sources:

```sh
bun run build-prod
bun run sync          # copies dist/ into the native projects
```

Then start it from the IDE, or directly:

```sh
bun run open-in-Android-Studio
bun run open-in-Xcode

bunx cap run android
bunx cap run ios
```

The scripts `run-on-galaxy-s24`, `run-on-i16`, `debug-android-s24` and `debug-ios-i16` in [package.json](package.json) carry the device ids of two particular phones. Replace the ids with your own (`bunx cap run android --list`, `bunx cap run ios --list`).

iOS needs a development team for signing. The project is set to automatic signing with team `HLX9TTSLFS`; change it in Xcode under Signing & Capabilities if you use another account.

### Testing an update with a local image

Serve a GBL file from the development machine and enter its address under "From URL":

```sh
cd /path/to/folder/with/gbl
python3 -m http.server 8000
```

```
http://<ip-of-this-machine>:8000/bt_soc_thermometer_mock.gbl
```

Phone and machine must be on the same network. iOS asks once for permission to access the local network.

## Releases

The workflow [.github/workflows/app-release.yml](.github/workflows/app-release.yml) produces signed builds on GitHub's runners.

| Trigger | Result |
|---------|--------|
| Tag `v<version>`, e.g. `v0.1.1` | Signed APK, AAB and IPA attached to a GitHub release; the IPA is also uploaded to TestFlight |
| "Run workflow" on GitHub | The same three files as workflow artifacts; no release, no TestFlight |

```sh
git tag v0.1.1
git push origin v0.1.1
```

The version name comes from the tag (from `package.json` on a manual run); the build number is the workflow run number.

- **Android** is signed with a keystore taken from the repository secrets.
- **iOS** is archived unsigned and signed at export with Xcode's cloud-managed signing, authorised by an App Store Connect API key. No certificates or profiles are stored.

### Signing setup

The workflow needs seven repository secrets. They are derived from local files and values listed in [.env.example](.env.example):

| `.env` entry | Meaning |
|--------------|---------|
| `ASC_KEY_PATH` | App Store Connect API key file (`AuthKey_<id>.p8`), Admin role |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | Id of that key and issuer id of the account |
| `ANDROID_KEYSTORE_PATH` | Android release keystore |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Keystore password, key alias, key password |

Copy `.env.example` to `.env`, fill it in, and push the values to GitHub:

```sh
scripts/sync-app-secrets.sh --env-file .env
```

`.env` is ignored by git. The script needs the GitHub CLI (`gh`), logged in with access to the repository. It prints the names of the secrets it sets, not their values. An `.env` from another project with the same entries can be used directly with `--env-file`.

Also needed once, by hand:

- an app record for the bundle id `com.balloonware.thermometerota` in App Store Connect, for the TestFlight upload;
- the team id in [ci/ExportOptions-export.plist](ci/ExportOptions-export.plist) and [ci/ExportOptions-upload.plist](ci/ExportOptions-upload.plist), if it is not `HLX9TTSLFS`.

Local release builds are unsigned unless `ANDROID_KEYSTORE_PATH` and the three password and alias variables are set in the environment.

## Limitations

- **Plain HTTP is allowed everywhere** (`usesCleartextTraffic` on Android, `NSAllowsArbitraryLoads` on iOS) so that images can be served from a development machine. Tighten this before any public distribution.
- **No check of who may update.** The firmware accepts an update from any connected client, and images are neither signed nor encrypted.
- **One device at a time.** After an update the app reconnects to the first thermometer it sees, and in update mode it takes the first device advertising as `OTA`. With several devices in range it may pick another one.
- **iOS** cannot scan in the background, so the app must stay in the foreground during an update.
- **GitHub API limit:** release lookups are unauthenticated, 60 per hour per IP address.
- Firmware images older than the first tagged release report the Bluetooth stack version as firmware version and may look newer than any release. Update those once from a URL.
