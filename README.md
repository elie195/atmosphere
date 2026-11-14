<p align="center"><img src="docs/icon.png" width="96" alt=""></p>

# Atmosphere

A Safari extension for macOS that gets Netflix to play **Dolby Atmos** in Safari.

> **Vibecoded.** I built this in one session with Claude (Claude Code): the debugging, the extension, the icon and this README. I tested it on my own Mac and it works there, but expect rough edges.

## What it does

Netflix in Safari normally gets Dolby Digital Plus 5.1 at most, and macOS shows it as **Multichannel**. Atmosphere fixes two separate problems:

1. **Netflix doesn't ask for Atmos in Safari.** Atmosphere adds the Dolby profiles (`ddplus-atmos-dash`, among others) to the list of audio formats Netflix's player requests. On titles that have it, Netflix then sends an Atmos (DD+ JOC) stream.
2. **Safari doesn't switch into Atmos mode for streaming playback.** Safari plays Atmos through its streaming path (MSE) as "Multichannel", unless an Atmos file has already played through a plain `<audio src>` element in the same Safari session. Atmosphere plays a near-silent, 4-second Dolby Atmos test clip that way when Netflix opens, or on your first click. Safari then stays in Atmos mode. This is a WebKit bug, reported as [WebKit bug 331672](https://bugs.webkit.org/show_bug.cgi?id=331672) (details in [docs/webkit-bug.md](docs/webkit-bug.md)).

Atmosphere doesn't touch DRM or decrypt anything. It only adjusts the player's request and reads the audio stream's header (codec, channels, Atmos flag) to show its status.

The toolbar popup shows:
- whether Atmos was requested,
- what's playing (Atmos, DD+ 5.1 or AAC stereo, with bitrate), including any stream changes mid-playback,
- whether Safari is in Atmos mode.

It has toggles for each feature and an optional **Debug mode** with logs.

## Requirements

- macOS with Safari 17 or later (built and tested on macOS 27 / Safari 27, Apple Silicon)
- Xcode, for building
- A Netflix plan that includes Atmos, and Atmos-capable output (AirPods with Spatial Audio, recent MacBook speakers, etc.)

## Build and install

```bash
git clone https://github.com/meghrathod/atmosphere.git
cd atmosphere
./tools/fetch-prime-clip.sh   # downloads Dolby's public Atmos test clip (not redistributed here)
cd Atmosphere
xcodebuild -scheme Atmosphere -configuration Release -derivedDataPath build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<your team ID> build
cp -R build/Build/Products/Release/Atmosphere.app ~/Applications/
open ~/Applications/Atmosphere.app
```

A free Apple ID works for signing: add it in Xcode → Settings → Accounts, and use its "Personal Team" ID. Then turn on **Atmosphere** in Safari → Settings → Extensions and allow it on netflix.com.

If you don't want to sign it, you can load it unsigned instead: turn on Safari → Settings → Developer → *Allow unsigned extensions*, then use *Add Temporary Extension…* and pick the `netflix-atmos` folder.

## Repository layout

| Path | What it is |
|---|---|
| `netflix-atmos/` | The web extension: `page.js` (request and playback hooks), `content.js` (priming, state), `dec3.js` (audio header parser), popup |
| `Atmosphere/` | Xcode wrapper app generated with `safari-web-extension-converter` |
| `atmos-mse-test.html` | Test page: plays the Dolby clip directly, through MSE, and through MSE with video |
| `atmos-probe.html` | Reports what Safari tells sites about Dolby audio support |
| `tools/` | Icon generator and clip downloader |

## Caveats

- This is unofficial and not affiliated with Netflix, Dolby or Apple. Changing what Netflix's player requests may go against Netflix's terms of use, so use it at your own risk.
- It depends on how Netflix's web player works today and may break whenever Netflix changes it.
- Priming keeps Safari in Atmos mode, so Control Center shows "Dolby Atmos" even for 5.1 content. The popup's **Playing in Atmos** step tells you what's actually playing.

## License

MIT. See [LICENSE](LICENSE). The Dolby test clip isn't included and stays under Dolby's terms.
