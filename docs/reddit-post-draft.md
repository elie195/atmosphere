# Reddit post draft (for you to post yourself)

Before posting, check the subreddit's rules, especially self-promotion and AI or vibe-coded app disclosure, and any required post flair. r/macapps fits best.

**Title:** [OSS] Atmosphere: Dolby Atmos for Netflix in Safari (vibecoded)

**Body:**

Netflix in Safari tops out at 5.1 ("Multichannel"). I built a small, free Safari extension that gets real Atmos working.

- Asks Netflix's player for its Atmos audio profiles.
- Works around a Safari bug where streaming (MSE) Atmos plays as Multichannel until an Atmos file has played the normal way. It plays a near-silent 4-second Dolby test clip first. Reported to WebKit: https://bugs.webkit.org/show_bug.cgi?id=331672
- Popup shows what's actually playing (Atmos, 5.1 or stereo), including mid-playback stream changes.

**Disclosure:** fully vibecoded with Claude Code. Tested on my M-series Mac with AirPods Pro, macOS 27 / Safari 27. Unofficial, not affiliated with Netflix/Dolby/Apple, and may go against Netflix's terms. Build it from source with Xcode (free Apple ID is enough).

https://github.com/meghrathod/atmosphere
