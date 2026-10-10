# ABC News for Gloomberb

The ABC NEWS Australia live channel and its latest video stories, in a
[Gloomberb](https://github.com/gloom-sh/gloomberb) pane. Type `TVABC` in the
command bar to open it.

- **Live** plays the 24/7 ABC NEWS stream.
- **Stories** lists the channel's latest 45 uploads, newest first, and `/`
  searches their titles and summaries. Enter plays
  the story in the pane; `o` opens it on YouTube. An open story is kept
  across restarts, but only starts playing again when you press `p`.

| Key | Action |
| --- | --- |
| `h` / `l` | Switch between Live and Stories |
| `j` / `k`, Enter | Move through stories, play one |
| `/` | Search stories; Down moves to the results, Esc clears |
| Esc | Back to the list |
| `p` | Play / pause |
| `m` | Mute / unmute |
| `o` | Open in the browser |
| `r` | Refresh the stream or the story list |

## Playback

On the desktop app video plays inside the pane. In the terminal, `p` (or
Enter on a story) hands the terminal to [mpv](https://mpv.io) until you quit
it, so mpv must be installed (`brew install mpv`) and the terminal must
support the kitty graphics protocol.

On the desktop and in the terminal, stories play at 360p: it is the one YouTube format that carries
sound and picture in a single file, which is what both players need. The
YouTube embedded player is not used there, because YouTube refuses to play in the
desktop app's page (error 153: the page has no web origin to send as a
referrer). On Windows the desktop player only handles HLS, so stories play
in the terminal or open in the browser there; live works everywhere.

The list comes from the channel's Videos tab, which reaches back as far as
needed but only says "3 hours ago" and leaves Shorts out. The channel's feed
supplies exact times and summaries for the most recent fifteen uploads.

The live stream comes from ABC News Australia's YouTube channel. The ABC iview
stream is not used: its HLS URLs need a signed token.

## On the web

The web build has no native process to run the YouTube resolver in, and a
stream URL resolved through its proxy would be tied to the proxy's address
rather than the viewer's. So on the web:

- Live and stories play in YouTube's own embed (`www.youtube.com/embed`),
  which YouTube accepts there because the page has a real web origin. The
  host's content security policy must allow it as a frame source
  (`frame-src https://www.youtube.com`); Gloomberb's own does not.
- Live is YouTube's channel live embed, which plays whatever the channel is
  streaming when it loads, so no lookup is needed when ABC restarts the
  stream under a new video id.
- Stories are the channel feed alone, fetched through the web app's proxy:
  the latest fifteen uploads, Shorts included, rather than forty-five.
- `r` reloads the player. An upload whose owner has switched off embedding
  shows YouTube's own error in the player; `o` opens it on YouTube.

The browser entry (`index.browser.ts`) carries this web capability. The
desktop's webview also loads that entry but never runs plugin capability
handlers, so the desktop keeps using the native resolver.

## Development

```bash
bun install
gloomberb plugin link .
gloomberb plugin doctor gloom-abcnews
bun run typecheck && bun test
```
