# Real calibration recordings (optional)

`npm run engine:evaluate` scores labelled pairs of sounds. Synthetic pairs are built in, and they only check that the engine behaves sensibly. Real recordings tell you how it does on actual microphones and rooms.

Put WAV files here, plus a `manifest.json`:

```json
{
  "pairs": [
    { "input": "phone-a4.wav", "reference": "piano-a4.wav", "label": "same note, phone mic", "strategy": "pitch", "expect": "high" },
    { "input": "clap-2.wav", "reference": "clap-1.wav", "label": "same sound, re-recorded", "strategy": "timbre", "expect": "high" },
    { "input": "door.wav", "reference": "clap-1.wav", "label": "different sounds", "strategy": "timbre", "expect": "low" }
  ]
}
```

- `strategy`: `pitch` (musical notes) or `timbre` (any sound).
- `expect` (optional): `high`, `mid` or `low`. It's only printed next to the results.

Everything in this folder except this README is git-ignored, because recordings often carry third-party licenses.
