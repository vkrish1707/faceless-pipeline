# Background music tracks

Phase 7 picks one of these tracks per render based on the modal `tone` in
the script's visual beats. The mapping lives in
`apps/studio/lib/music/pickTrack.ts`:

| tone        | track file              |
|-------------|-------------------------|
| urgent      | `urgent_pulse.mp3`      |
| explainer   | `calm_focus.mp3`        |
| payoff      | `motivational_lift.mp3` |
| cinematic   | `cinematic_swell.mp3`   |
| _(default)_ | `neutral_groove.mp3`    |

The actual MP3 files are not committed — drop royalty-free 32–60s loops
under these exact names. If a track is missing, the render orchestrator
warns and skips the mix; the render itself still succeeds.

Gain is `-18 dB` by default (configurable via Setting `music_gain_db`).
