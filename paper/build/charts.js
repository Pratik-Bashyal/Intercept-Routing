// Render the paper's two figures as PNG buffers using @napi-rs/canvas.
// Mirrors the pgfplots bar charts in intercept.tex.
const { createCanvas } = require("@napi-rs/canvas");

const SCALE = 2; // supersample for crisp output
const COLORS = ["#2b6cb0", "#dd6b20"]; // IEEE-ish blue / orange

function barChart({ width = 520, height = 300, yMax, yLabel, categories, series, legend }) {
  const W = width * SCALE, H = height * SCALE;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const mL = 52, mR = 14, mT = 20;
  const mB = legend ? 62 : 44;
  const plotW = width - mL - mR;
  const plotH = height - mT - mB;
  const x0 = mL, y0 = mT + plotH; // origin (bottom-left of plot)

  const num = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // y grid + ticks
  ctx.strokeStyle = "#dddddd";
  ctx.fillStyle = "#333333";
  ctx.lineWidth = 1;
  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const val = (yMax / ticks) * i;
    const y = y0 - (val / yMax) * plotH;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + plotW, y); ctx.stroke();
    ctx.fillText(num(val), x0 - 6, y);
  }

  // axes
  ctx.strokeStyle = "#333333"; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x0, mT); ctx.lineTo(x0, y0); ctx.lineTo(x0 + plotW, y0); ctx.stroke();

  // y-axis label (rotated)
  ctx.save();
  ctx.translate(14, mT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#333333"; ctx.font = "12px Arial";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // bars
  const nCat = categories.length;
  const nSer = series.length;
  const groupW = plotW / nCat;
  const groupPad = groupW * 0.22;
  const innerW = groupW - groupPad * 2;
  const barW = innerW / nSer;

  for (let c = 0; c < nCat; c++) {
    const gx = x0 + c * groupW + groupPad;
    for (let s = 0; s < nSer; s++) {
      const v = series[s].data[c];
      const bh = (v / yMax) * plotH;
      const bx = gx + s * barW;
      const by = y0 - bh;
      ctx.fillStyle = COLORS[s % COLORS.length];
      ctx.fillRect(bx, by, barW - 2, bh);
      // value label
      ctx.fillStyle = "#222222"; ctx.font = "10px Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(num(v), bx + (barW - 2) / 2, by - 2);
    }
    // category label
    ctx.fillStyle = "#333333"; ctx.font = "11px Arial";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(categories[c], x0 + c * groupW + groupW / 2, y0 + 6);
  }

  // legend
  if (legend) {
    const ly = height - 20;
    ctx.font = "11px Arial"; ctx.textBaseline = "middle";
    const items = series.map((s, i) => s.name);
    const widths = items.map(t => ctx.measureText(t).width + 26);
    const total = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 14;
    let lx = (width - total) / 2;
    for (let i = 0; i < items.length; i++) {
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(lx, ly - 6, 12, 12);
      ctx.fillStyle = "#333333"; ctx.textAlign = "left";
      ctx.fillText(items[i], lx + 16, ly);
      lx += widths[i] + 14;
    }
  }

  return canvas.toBuffer("image/png");
}

function prevalenceChart() {
  return barChart({
    yMax: 65,
    yLabel: "% of servable O\u2013D pairs",
    categories: ["Direct", "Any intercept", "Genuine"],
    series: [{ name: "Share", data: [13.2, 57.3, 5.7] }],
  });
}

function reliabilityChart() {
  return barChart({
    yMax: 20,
    yLabel: "minutes",
    categories: ["Expected wait", "Mistiming penalty"],
    series: [
      { name: "Direct (target)", data: [9.0, 17.9] },
      { name: "Intercept (connector)", data: [3.0, 6.0] },
    ],
    legend: true,
  });
}

module.exports = { prevalenceChart, reliabilityChart };

if (require.main === module) {
  const fs = require("fs");
  fs.writeFileSync("fig1.png", prevalenceChart());
  fs.writeFileSync("fig2.png", reliabilityChart());
  console.log("wrote fig1.png, fig2.png");
}
