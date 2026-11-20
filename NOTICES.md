# Third-party notices

Truefit includes or depends on the following. Each keeps its own licence; this list is a starting point and must be re-checked against the exact versions in `app/package-lock.json` before a release.

| Component | Used for | Licence |
|---|---|---|
| Electron | the app shell | MIT |
| React, React DOM | the screens | MIT |
| GSAP (`gsap`, `@gsap/react`) | the motion on the verdict and New job screens | GSAP Standard ("no charge") licence; check its terms against how the app is distributed before a release |
| Claude Agent SDK and the bundled Claude program | talking to Claude | Anthropic's terms (see the SDK package); the program is the user's own sign-in to Claude, not redistributed as a service |
| pdf.js (`pdfjs-dist`) | reading text from the CV PDF for the ATS checks | Apache-2.0 |
| fflate | zip export and import | MIT |
| Crimson Text (font, `engine/assets/fonts`) | the CV typeface | SIL Open Font License 1.1 (`OFL.txt` is next to the font) |
| Vite, electron-vite, Vitest, Playwright, @electron/packager, @electron/fuses, axe-core | build and test only (not shipped) | MIT, Apache-2.0 and MPL-2.0 (axe-core) |
| OpenAI API and Sign in with ChatGPT | talking to OpenAI | OpenAI's terms. No OpenAI code or program is bundled (plain HTTPS from the app). Using a ChatGPT plan is subject to OpenAI's Sign in with ChatGPT terms, which have not been read yet (see docs/OPENAI-BUILD-ISSUES.md). |

TO CHECK before release: the exact licence of every package in the shipped bundle (run a licence report on `app/node_modules` production dependencies), and the Anthropic terms for redistributing the Claude program inside an app.

## Speech to text (voice)
- Whisper tiny English (OpenAI, MIT licence), in the ONNX form published as `Xenova/whisper-tiny.en` on huggingface.co (Apache-2.0 licence on that repository; check the licence text before any publication). Files in `app/voice/models`: encoder_model_quantized.onnx, decoder_model_merged_quantized.onnx and their config and tokenizer files (about 43 MB). Run on the device by `@huggingface/transformers` 4.3.2 (Apache-2.0) with `onnxruntime-node` (MIT) and `sharp` (Apache-2.0, with libvips under LGPL: `@img/sharp-libvips-darwin-arm64`). Nothing is downloaded at run time.
