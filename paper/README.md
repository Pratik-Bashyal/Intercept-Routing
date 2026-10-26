# Intercept — Research Paper

IEEE-style conference paper on the chase-and-intercept routing idea, backed by a
real evaluation over the live TransLink GTFS feed.

## Files
- `intercept.tex` — the paper (IEEEtran, `conference` option).
- `refs.bib` — bibliography (all keys used, none unused).
- `../eval-pairs.csv` — per-pair raw output from the evaluation harness.
- `results.txt` — the canonical summary numbers used in the paper.

## Fastest way to a PDF — Overleaf (no install)
1. Go to https://overleaf.com → **New Project → Upload Project**.
2. Zip the `paper/` folder (contains `intercept.tex` + `refs.bib`) and upload it.
   (Or: New Project → Blank, then upload both files.)
3. Overleaf auto-detects `intercept.tex` as the main file and compiles.
   Menu → Compiler should be **pdfLaTeX**. Click **Recompile**.
4. Done — `pgfplots` figures and BibTeX references build automatically.

## Build locally (if you install LaTeX)
Install MiKTeX (Windows) or TeX Live, then from this folder:
```
pdflatex intercept
bibtex   intercept
pdflatex intercept
pdflatex intercept
```
(Run the sequence so citations and cross-references resolve.)

## Reproduce every number in the paper
From the project root:
```
node src/evaluate.js 1500 20261007 42
```
This regenerates `eval-pairs.csv` and prints the summary block. Change the last
arg (seed) for the robustness run, e.g. `node src/evaluate.js 1500 20261007 7`.

## Notes
- The paper is honest that the headline "catch a bus you'd miss" feature is a
  **real-time** phenomenon; the batch evaluation establishes that the
  *opportunity* is common, and the case study shows the real-time payoff.
- No image files are needed — figures are drawn with `pgfplots` inside the `.tex`.
