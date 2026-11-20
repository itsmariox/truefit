# Third-party notices

## Crimson Text (bundled font)
- Files: `assets/fonts/CrimsonText-Regular.ttf`, `CrimsonText-Bold.ttf`, `CrimsonText-Italic.ttf`, unmodified, from https://github.com/google/fonts/tree/main/ofl/crimsontext
- Copyright 2010 The Crimson Text Project Authors (https://github.com/googlefonts/Crimson).
- Licence: SIL Open Font License 1.1. The full text is in `assets/fonts/OFL.txt` and ships with the font.
- Chosen because it has TrueType outlines: Chrome stores such a font in the PDF as a normal embedded CID TrueType font, whereas a CFF/OpenType web font (such as TeX Gyre Pagella) is stored as Type 3.

## pdf.js (pdfjs-dist 6.5.438, a dependency)
- Used to read the finished PDF for the ATS checks. Apache License 2.0, Mozilla and contributors. Licence text in `node_modules/pdfjs-dist/LICENSE`.


## humanizer (bundled skill)
- Files: `skills/humanizer/SKILL.md` (unchanged; pinned commit and hash in `skills/humanizer/SOURCE.md`), from https://github.com/blader/humanizer
- Licence: MIT. Full text, copied verbatim from the upstream LICENSE file:

```
MIT License

Copyright (c) 2025 Siqi Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## fflate (0.8.3, a dependency)
- Used to write and read the export zip (Settings > Data > Export and Import). MIT licence, Copyright (c) 2026 Arjun Barrett. Licence text in `node_modules/fflate/LICENSE`; it ships with the app.
