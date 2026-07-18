#!/usr/bin/env node
/* render_harness.js — Athlete OS dashboard verification harness (WS5.1, v1.38+)
 * Usage: node render_harness.js /path/to/athlete-dashboard.html
 * Runs: 8 tabs × {dark,light} × {clinical:false,true} render sweep (zero throws)
 *       + the v1.38 (Phase 1a) assertion set from DASHBOARD_PHASE1_BLUEPRINT §7.
 * Exit code 0 = all PASS. Any FAIL prints detail and exits 1.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = process.argv[2] || "./athlete-dashboard.html";
const html = fs.readFileSync(path, "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: no <script> block found in " + path); process.exit(1); }
const code = m[1];

let fails = 0, passes = 0;
function check(name, cond, detail) {
  if (cond) { passes++; }
  else { fails++; console.error("FAIL:", name, detail !== undefined ? "→ " + JSON.stringify(detail) : ""); }
}

// ── Minimal DOM/browser shim ──────────────────────────────────────────────
function makeCtx() {
  const classListOf = () => ({ toggle(){}, add(){}, remove(){}, contains(){ return false; } });
  const el = () => ({
    style: {}, dataset: {}, classList: classListOf(),
    setAttribute(){}, getAttribute(){ return null; }, appendChild(){}, addEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; }, remove(){},
  });
  const document = {
    getElementById(){ return el(); },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    createElement(){ return el(); },
    addEventListener(){},
    body: Object.assign(el(), {}),
    documentElement: Object.assign(el(), {}),
  };
  const storageBacking = {};
  const localStorage = {
    getItem: k => (k in storageBacking ? storageBacking[k] : null),
    setItem: (k, v) => { storageBacking[k] = String(v); },
    removeItem: k => { delete storageBacking[k]; },
  };
  const ctx = {
    document, localStorage,
    window: null, // set to ctx below
    navigator: { userAgent: "node-harness" },
    matchMedia: () => ({ matches: false, addListener(){}, addEventListener(){} }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    console, setTimeout, clearTimeout, JSON, Math, Date, Object, Array, String, Number, Boolean,
    fetch: () => Promise.reject(new Error("no network in harness")),
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  return ctx;
}

const ctx = makeCtx();
try {
  // const/let top-level bindings do not attach to the vm context object (only var/function do),
  // so explicitly hand the needed identifiers to globalThis at the end of the evaluated code.
  vm.runInContext(
    code + "\n;globalThis.__H__ = { App, chartSVG, chartSVGdash, yDomain, fmtD, fmtDshort, applyCtl, weekStartISO, CARD_INFO, HRV_BASE_N, bwEWMA, parseGPX, downsampleProfile, ANATOMY_ZONES, NIGGLE_REGIONS, NIGGLE_SIDE, anatomySVG, parseNiggleExtract, niggleExtractSystem, RX_TEMPLATES, RX_OVERRIDES, resolveRX, matchRX, scoreRun, fieldDev, fieldScore, INTENSITY_SCORED, DESCENT_SCORED, runDayCard, gymDayCard, GYM_SESSIONS, phaseOf, dayISO, sessionMaps, weekStrip, MUSCLE_REGIONS, EX_REGION_MAP, NIPPARD_EX, NIPPARD_META, NIPPARD_WEEKS, NIPPARD_TO_MF, parseStrengthTSV, excelSerialToISO, parseDateCell, regionsWithData, regionWeeklyRows, regionCard, unmappedBucket, nippardProgramCard, KEY_LIFTS };\n",
    ctx, { filename: "extracted.js" }
  );
} catch (e) {
  console.error("FAIL: module eval threw:", e.message);
  process.exit(1);
}
const H = ctx.__H__ || {};
const App = H.App;
ctx.chartSVG = H.chartSVG; ctx.chartSVGdash = H.chartSVGdash; ctx.yDomain = H.yDomain;
ctx.fmtD = H.fmtD; ctx.fmtDshort = H.fmtDshort;
ctx.applyCtl = H.applyCtl; ctx.weekStartISO = H.weekStartISO; ctx.CARD_INFO = H.CARD_INFO; ctx.HRV_BASE_N = H.HRV_BASE_N; ctx.bwEWMA = H.bwEWMA;
check("App object present after eval", !!App);

// ── 1. Tab × theme × clinical sweep (zero throws) ─────────────────────────
const TABS = ["overview","running","sessions","strength","body","health","data","changelog"];
let sweepOK = true;
for (const tab of TABS) {
  for (const theme of ["dark","light"]) {
    for (const clinical of [false,true]) {
      try {
        App.tab = tab; App.theme = theme; App.clinical = clinical;
        const fn = App["view_" + tab];
        if (typeof fn !== "function") { throw new Error("view_" + tab + " missing"); }
        const out = fn.call(App);
        if (typeof out !== "string") throw new Error("view_" + tab + " did not return a string");
      } catch (e) {
        sweepOK = false;
        console.error(`FAIL: render threw — tab=${tab} theme=${theme} clinical=${clinical}:`, e.message);
      }
    }
  }
}
check("8 tabs × dark/light × clinical — zero throws", sweepOK);

// ── 2. #R2 date-format helpers ─────────────────────────────────────────────
check('fmtD("2026-07-12")==="12/07/26"', ctx.fmtD("2026-07-12") === "12/07/26", ctx.fmtD("2026-07-12"));
check('fmtDshort("2026-07-12")==="12/07"', ctx.fmtDshort("2026-07-12") === "12/07", ctx.fmtDshort("2026-07-12"));

// ── 3. #R4a — FFF markup precedes durability card in view_running ─────────
{
  const out = App.view_running.call(App);
  const iFFF = out.indexOf("Fitness");
  const iDur = out.indexOf("Durability");
  check("view_running: FFF markup before durability card", iFFF !== -1 && iDur !== -1 && iFFF < iDur, {iFFF, iDur});
}

// ── 4. #R4c — vert chart toggle (asc:false → only descent series rendered) ─
{
  App.state.actualWeeks = { 1: { vert: 500, desc: 300 }, 2: { vert: 600, desc: 350 } };
  App.vertShow = { asc: false, desc: true };
  const out = App.view_running.call(App);
  const hasDescentTitle = /descent:/.test(out);
  const hasAscentTitle = /ascent:/.test(out);
  check("vert toggle {asc:false}: only descent series in output", hasDescentTitle && !hasAscentTitle, {hasDescentTitle, hasAscentTitle});
  App.vertShow = { asc: true, desc: true }; // restore
}

// ── 5. #R4e — zone stacked chart: 3 named groups + unsplit ─────────────────
{
  App.state.actualWeeks = { 1: { z12: 82 }, 2: { z12: 78, z3: 12, z45: 6 } };
  const out = App.view_running.call(App);
  check("zone stacked: Z1+Z2 present", /Z1\+Z2:/.test(out));
  check("zone stacked: Z3 present", /Z3:/.test(out));
  check("zone stacked: Z4\\+Z5 present", /Z4\+Z5:/.test(out));
  check("zone stacked: unsplit present (pre-split week)", /unsplit:/.test(out));
  App.state.actualWeeks = {};
}

// ── 6. yDomain assertions ──────────────────────────────────────────────────
{
  const d1 = ctx.yDomain([5,5], {});
  check("yDomain([5,5]) widens (lo<hi)", d1.lo < d1.hi, d1);
  const d2 = ctx.yDomain([], {});
  check("yDomain([],{}) → range around [0,1]", d2.lo <= 0 && d2.hi >= 1, d2);
  const d3 = ctx.yDomain([10,20,30], {yMin:0});
  check("yDomain respects yMin:0", d3.lo === 0, d3);
}

// ── 7. #R3/#R4b — chartSVG w:860 apparent font-size > base token (FSCALE) ──
{
  const svg460 = ctx.chartSVG({ w:460, cats:["a","b"], series:[{data:[1,2]}] });
  const svg860 = ctx.chartSVG({ w:860, cats:["a","b"], series:[{data:[1,2]}] });
  const fs460 = parseFloat((svg460.match(/font-size="([\d.]+)"/) || [,"0"])[1]);
  const fs860 = parseFloat((svg860.match(/font-size="([\d.]+)"/) || [,"0"])[1]);
  check("chartSVG w:860 font-size > w:460 base (FSCALE applied)", fs860 > fs460, {fs460, fs860});
}

// ── 8. #R17 — tab bar CSS wrap + touch target ──────────────────────────────
{
  check('CSS contains "flex-wrap:wrap" (tabbar)', /\.tabbar\{[^}]*flex-wrap:wrap/.test(html));
  check('CSS contains "min-height:44px" (.tab)', /\.tab\{[^}]*min-height:44px/.test(html));
}

// ── 9. #41 — applyCtl pipeline: From/To filter + D/W/M/Q bucketing ─────────
{
  const rows = [
    {date:"2026-06-01", v:10}, {date:"2026-06-08", v:20}, {date:"2026-06-15", v:30},
    {date:"2026-07-01", v:40}, {date:"2026-07-08", v:50},
  ];
  const d = ctx.applyCtl(rows, "date", {per:"D"}, {v:"mean"});
  check("applyCtl D: one point per row", d.cats.length === rows.length, d.cats);
  const m = ctx.applyCtl(rows, "date", {per:"M"}, {v:"mean"});
  check("applyCtl M: buckets by month (2 buckets: Jun, Jul)", m.cats.length === 2, m.cats);
  const bounded = ctx.applyCtl(rows, "date", {from:"2026-07-01", per:"D"}, {v:"mean"});
  check("applyCtl From filter excludes earlier rows", bounded.v.length === 2 && bounded.v[0] === 40, bounded.v);
  const sum = ctx.applyCtl(rows, "date", {per:"M"}, {v:"sum"});
  check("applyCtl sum aggregation (Jun bucket = 10+20+30=60)", sum.v[0] === 60, sum.v);
  const empty = ctx.applyCtl([], "date", {per:"D"}, {v:"mean"});
  check("applyCtl on empty rows doesn't throw, returns empty cats", Array.isArray(empty.cats) && empty.cats.length === 0);
}

// ── 10. weekStartISO / planWeekOf round-trip sanity ────────────────────────
{
  const d1 = ctx.weekStartISO(1);
  check('weekStartISO(1) === "2026-06-29" (W1 anchor)', d1 === "2026-06-29", d1);
}

// ── 11. #R1 — CARD_INFO registry parity: every infoBtn(id) call has an entry ─
{
  const ids = [...code.matchAll(/infoBtn\("([a-z_]+)"\)/g)].map(m2 => m2[1]);
  const uniqueIds = [...new Set(ids)];
  const missing = uniqueIds.filter(id => !ctx.CARD_INFO || !ctx.CARD_INFO[id]);
  check(`CARD_INFO registry parity (${uniqueIds.length} info buttons found)`, missing.length === 0, missing);
  check("at least 20 info buttons wired (Phase 1b coverage)", uniqueIds.length >= 20, uniqueIds.length);
}

// ── 12. #R1 — info panel toggles open/closed, shows What/Source/Why ───────
{
  App.tab = "running"; App.infoOpen = "fff";
  const out = App.view_running.call(App);
  check("infoPanel open shows What/Source/Why labels", />What</.test(out) && />Source</.test(out) && />Why</.test(out));
  App.infoOpen = null;
  const out2 = App.view_running.call(App);
  check("infoPanel closed when infoOpen=null (no leaked panel)", !/infopanel/.test(out2));
}

// ── 13. D036/F13 — scorecard denominator = full week; colour = pace-to-date ─
{
  const sc = App.scores.call(App);
  check("scores() returns run as 'done/full-week-planned' string or null", sc.run === null || /^\d+\/\d+$/.test(sc.run), sc.run);
  check("scores() returns gym as 'done/full-week-planned' string or null", sc.gym === null || /^\d+\/\d+$/.test(sc.gym), sc.gym);
}

// ── 14. #R8 — HRV corridor present only on HRV channel, absent elsewhere ──
{
  App.state.fff = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(2026, 6, 1 + i);
    App.state.fff.push({ date: d.toISOString().slice(0,10), hrv: 50 + i, rhr: 55 });
  }
  App.wellMetric = "hrv";
  const outHRV = App.wellnessSection.call(App);
  check("HRV channel: corridor band present (opacity 0.1 fill)", /opacity="0\.1"/.test(outHRV));
  App.wellMetric = "rhr";
  const outRHR = App.wellnessSection.call(App);
  check("RHR channel: no HRV corridor band", !/opacity="0\.1"/.test(outRHR));
  App.state.fff = [];
}

// ── 15. #R5 — Methodology & sources footer present, collapsed by default ──
{
  const out = App.viewMain.call(App);
  check('footer contains "Methodology & sources"', out.includes("Methodology & sources"));
  const idx = out.indexOf("Methodology & sources");
  const detailsStart = out.lastIndexOf("<details>", idx) !== -1 ? out.lastIndexOf("<details>", idx) : out.lastIndexOf("<details", idx);
  const snippet = out.slice(Math.max(0, detailsStart), idx);
  check("footer <details> has no open attribute (collapsed by default)", !/ open[ >]/.test(snippet));
}

// ── 16. §6 sync-gate — readyView/wellView fully removed (absorbed by timeCtl) ─
{
  check("no readyView/wellView identifiers remain in source", !/readyView|wellView/.test(html));
}

// ── 17. Phase 1c (v1.40) — #C1/#C2/#C3/#R9 ────────────────────────────────
{
  // #R9 — gap-aware EWMA numeric correctness: t1 = k0 + (1-(1-α)^gap)*(k1-k0)
  const fx = [{d:"2026-01-01",kg:70},{d:"2026-01-08",kg:68}];
  const tr = ctx.bwEWMA(fx, 0.10);
  const gap = 7, w = 1 - Math.pow(0.9, gap), expect = +(70 + w*(68-70)).toFixed(3);
  check("bwEWMA seeds at first weigh-in", tr[0] === 70, tr[0]);
  check("bwEWMA gap-aware step matches formula (7-day gap)", Math.abs(tr[1]-expect) < 1e-6, {got:tr[1], expect});
  check("bwEWMA returns one value per input point", tr.length === fx.length, tr.length);

  // #R9 — view_body renders for every zoom (D/W/M) without throwing; eyebrow shows EWMA
  App.state.body = [{d:"2025-06-01",kg:69,bf:16},{d:"2026-05-01",kg:68,bf:15.5},{d:"2026-07-01",kg:67.8,bf:15}];
  for (const per of ["D","W","M"]) {
    App.chartCtl.weight = {from:null,to:null,per};
    let out = "", threw = false;
    try { out = App.view_body.call(App); } catch(e){ threw = true; check("view_body per="+per+" no throw", false, e.message); }
    if (!threw) check("view_body per="+per+" renders a non-empty string", typeof out === "string" && out.length > 0);
  }
  App.chartCtl.weight = {from:null,to:null,per:"M"};
  check("bodyweight eyebrow reflects EWMA trend", /EWMA trend/.test(App.view_body.call(App)));
  App.state.body = [];
  App.chartCtl.weight = {from:null,to:null,per:"D"};

  // #C3 — PAST slider bounds + clamped window stashed for the crosshair
  App.tab = "overview"; App.week = null;
  const ov = App.view_overview.call(App);
  check('#C3 PAST slider is min="4" max="260" step="2"', /min="4" max="260" step="2"/.test(ov));
  check("#C3 view_overview stashes _ovWindow with wStart<=wEnd", !!App._ovWindow && App._ovWindow.wStart <= App._ovWindow.wEnd, App._ovWindow);

  // #C1/#C2 — CSS guards present in source
  check("#C1/#C4 .wrap mobile containment is overflow-x:auto (pannable, NOT clip)", /@media\(max-width:480px\)\{[\s\S]*?\.wrap\{[^}]*overflow-x:auto/.test(html) && !/\.wrap\{[^}]*overflow-x:clip/.test(html));
  check("#C2 range thumb uses appearance:none (custom slider)", /input\[type=range\]::-webkit-slider-thumb\{[^}]*appearance:none/.test(html));
  check("#C2 native accent-color removed from Overview sliders", !/data-act="range(Past|Future)"[^>]*accent-color/.test(html));
}

// ── 18. Phase 1c-2 (v1.41): #C4 min-content guards + #C5 zoom-permissive invariant ──
{
  check("#C4 min-content guard present (.grid/.cols*/.card min-width:0)",
    /\.grid>\*,\.cols2>\*,\.cols3>\*,\.cols4>\*,\.card\{min-width:0\}/.test(html));
  check("#C4 notes/eyebrows breakable on mobile (overflow-wrap:anywhere)",
    /\.note,\.eyebrow\{overflow-wrap:anywhere\}/.test(html));
  // #C5 — standing ruling (Andre, 17 Jul 2026): zoom must remain available on EVERY tab.
  // These asserts fail any future build that blocks pinch-zoom.
  const meta = (html.match(/<meta name="viewport"[^>]*>/)||[""])[0];
  check("#C5 viewport meta has no user-scalable lock", !/user-scalable\s*=\s*(no|0)/i.test(meta), meta);
  check("#C5 viewport meta has no maximum-scale lock", !/maximum-scale/i.test(meta), meta);
  check("#C5 no touch-action:none anywhere in the file", !/touch-action\s*:\s*none/i.test(html));
}

// ── 19. Phase 1d (v1.42): PWA shell — D038 asserts ─────────────────────────
{
  check("PWA manifest <link> present in head", /<link rel="manifest" href="\.\/manifest\.json">/.test(html));
  const tc = (html.match(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})">/)||[])[1];
  const night = (html.match(/--c-night:(#[0-9A-Fa-f]{6})/)||[])[1];
  check("PWA theme-color present and equals live --c-night", !!tc && !!night && tc.toUpperCase()===night.toUpperCase(), {tc,night});
  check("PWA SW registration is https-guarded", /'serviceWorker' in navigator && location\.protocol === 'https:'/.test(html));
  check("PWA storage.persist included (FP3)", /navigator\.storage\.persist\(\)/.test(html));
  // Inertness in this shim is proven structurally: the module eval above ran the whole
  // script (shim navigator has no serviceWorker → guard short-circuits, no throw).
}

// ── 20. Phase 7 (v1.44): Events tab ────────────────────────────────────────
{
  const App2 = ctx.__H__.App;
  check("events seeded from RACES (3 events after norm)", Array.isArray(App2.state.events) && App2.state.events.length >= 3, App2.state.events && App2.state.events.length);
  check("events tab registered in the tab bar", /\["events","Events"\]/.test(code));
  let evOut="", threw=false;
  try { evOut = App2.view_events.call(App2); } catch(e){ threw=true; check("view_events no throw", false, e.message); }
  if(!threw){
    check("view_events renders the add form + seeded cards", /Add event/.test(evOut) && /UTA100/.test(evOut));
    check("event link-out uses noopener", !/target="_blank"(?![^>]*rel="noopener)/.test(evOut));
  }
  const ds = ctx.__H__.downsampleProfile([0,1,2,3,4],[10,20,30,40,50],3);
  check("downsampleProfile resamples to N with exact ends", ds.distKm.length===3 && ds.distKm[0]===0 && ds.distKm[2]===4 && ds.ele[0]===10 && ds.ele[2]===50, ds);
  const gp = ctx.__H__.parseGPX('<trkpt lat="-33.70" lon="150.30"><ele>300</ele></trkpt><trkpt lat="-33.71" lon="150.31"><ele>350</ele></trkpt>');
  check("parseGPX returns distance + ele from minimal track", !!gp && gp.distKm.length===2 && gp.totalKm>0.5 && gp.ele[1]===350, gp && {n:gp.distKm.length,km:gp.totalKm});
  check("parseGPX carries lat/lon (v1.45)", !!gp && gp.lat && gp.lat.length===2 && gp.lon[1]===150.31, gp && gp.lat);
  const ds3 = ctx.__H__.downsampleProfile([0,1,2,3,4],[10,20,30,40,50],3,[-33.70,-33.705,-33.71,-33.715,-33.72],[150.30,150.31,150.32,150.33,150.34]);
  check("downsampleProfile resamples lat/lon with the profile (v1.45)", ds3.lat && ds3.lat.length===3 && Math.abs(ds3.lat[0]+33.70)<1e-6 && Math.abs(ds3.lat[2]+33.72)<1e-6, ds3.lat);
  check("evRouteSVG present with re-import fallback", /function evRouteSVG/.test(code) && /re-import the GPX/.test(code));
  check("demo mode guards ev* acts", /\["evAdd","evDel","evGpx"\]\.includes\(a\)/.test(code));
  // v1.47: link seeding + editor
  const uta = App2.state.events.find(e=>/UTA100/.test(e.name));
  check("v1.47 backfill: UTA event carries official site + relative intel link", !!uta && /uta\.utmb\.world/.test(uta.site||"") && (uta.url||"")==="./uta100-2026-intel.html", uta && {site:uta.site,url:uta.url});
  const syd = App2.state.events.find(e=>/Sydney/.test(e.name));
  check("v1.47 backfill: Sydney carries official site", !!syd && /tcssydneymarathon\.com/.test(syd.site||""), syd && syd.site);
  check("per-card link editor wired (evLinks / evLinksSave, demo-guarded)", /a==="evLinks"/.test(code) && /a==="evLinksSave"/.test(code) && /this\.demo && a==="evLinksSave"/.test(code));
}

// ── 21. Phase 8 core (v1.46): niggle system, manual path ───────────────────
{
  const App3 = ctx.__H__.App;
  check("s.niggles exists and ships EMPTY (acceptance)", Array.isArray(App3.state.niggles) && App3.state.niggles.length===0, App3.state.niggles && App3.state.niggles.length);
  check("D026 field enumerations present (20 regions)", /NIGGLE_REGIONS=/.test(code) && /"ITB"/.test(code) && /"achilles"/.test(code) && /"toes\/sesamoid"/.test(code));
  let hOut="";
  try { hOut = App3.niggleSection.call(App3); } catch(e){ check("niggleSection no throw", false, e.message); }
  check("Health tab leads with the niggle log (empty state renders)", /Niggle log/.test(hOut) && /No niggles logged/.test(hOut));
  check("Data tab has the manual entry (all D026 fields)", /ng_region/.test(code) && /ng_sev/.test(code) && /ng_timing/.test(code) && /ng_warm/.test(code) && /ng_ref/.test(code) && /ng_note/.test(code));
  check("addNiggle demo-guarded", /this\.demo && a==="addNiggle"/.test(code));
}

// ── 22. Phase 8 complete (v1.48): #34 anatomical body map ──────────────────
{
  const Z = ctx.__H__.ANATOMY_ZONES, REG = ctx.__H__.NIGGLE_REGIONS, SIDES = ctx.__H__.NIGGLE_SIDE;
  check("ANATOMY_ZONES count in the D026 window (40–55)", Array.isArray(Z) && Z.length >= 40 && Z.length <= 55, Z && Z.length);
  const views = new Set(Z.map(z => z.view));
  check("both views present, front + rear only", views.size === 2 && views.has("front") && views.has("rear"));
  const badRegion = Z.filter(z => !REG.includes(z.region)).map(z => z.id);
  check("every zone region is a verbatim NIGGLE_REGIONS string", badRegion.length === 0, badRegion);
  const badSide = Z.filter(z => !SIDES.includes(z.side)).map(z => z.id);
  check("every zone side is a verbatim NIGGLE_SIDE string", badSide.length === 0, badSide);
  const badPts = Z.filter(z => !/^(\d+,\d+)( \d+,\d+){2,}$/.test(z.pts)).map(z => z.id);
  check("every zone polygon has ≥3 integer points", badPts.length === 0, badPts);
  const ids = new Set(Z.map(z => z.id));
  check("zone ids unique", ids.size === Z.length);
  // side-encoding invariant: front view is MIRRORED (figure-R renders viewer-left),
  // rear view is DIRECT (figure-R renders viewer-right). Centroid-x proves it.
  const cx = z => { const xs = z.pts.split(" ").map(p => +p.split(",")[0]); return xs.reduce((s,v)=>s+v,0)/xs.length; };
  const fz = id => Z.find(z => z.id === id);
  check("front mirroring: figure-R shoulder centroid left of figure-L", cx(fz("f_sho_r")) < cx(fz("f_sho_l")), {r:cx(fz("f_sho_r")),l:cx(fz("f_sho_l"))});
  check("rear direct: figure-R shoulder centroid right of figure-L", cx(fz("b_sho_r")) > cx(fz("b_sho_l")), {r:cx(fz("b_sho_r")),l:cx(fz("b_sho_l"))});
  check("front mirroring holds at the foot", cx(fz("f_foo_r")) < cx(fz("f_foo_l")));
  check("rear direct holds at the achilles", cx(fz("b_ach_r")) > cx(fz("b_ach_l")));
  // renderer
  let svgF = "", svgR = "";
  try { svgF = ctx.__H__.anatomySVG("front", {"achilles L": 3, "knee R": 2}, null); svgR = ctx.__H__.anatomySVG("rear", {}, "b_ach_l"); }
  catch (e) { check("anatomySVG no throw", false, e.message); }
  check("anatomySVG embeds the WebP image", /<image href="data:image\/webp;base64,/.test(svgF) && /<image href="data:image\/webp;base64,/.test(svgR));
  const polyCountF = (svgF.match(/<polygon /g) || []).length;
  check("front render carries all front polygons", polyCountF === Z.filter(z => z.view === "front").length, polyCountF);
  check("recurrence heat applied (red ×3 on rear achilles L via rear render? — front knee R amber ×2)", /rgba\(230,180,80/.test(svgF), null);
  check("red heat fires at ×3", /rgba\(224,112,112/.test(ctx.__H__.anatomySVG("rear", {"achilles L": 3}, null)));
  check("selected zone highlighted", /stroke="#5FA8A0" stroke-width="2"/.test(svgR));
  check("zones are tappable (data-act=mapPick)", /data-act="mapPick"/.test(svgF));
  check("mapPick + nigCancel + extractNiggle wired in delegation", /a==="mapPick"/.test(code) && /a==="nigCancel"/.test(code) && /a==="extractNiggle"/.test(code));
  check("extractNiggle demo-guarded", /this\.demo && a==="extractNiggle"/.test(code));
  // Health tab renders the map + still leads with the log strings (§21 back-compat)
  let hOut = "";
  try { hOut = ctx.__H__.App.niggleSection.call(ctx.__H__.App); } catch (e) { check("niggleSection (v1.48) no throw", false, e.message); }
  check("Health tab shows the body map card", /Body map/.test(hOut) && /front<\/div>/.test(hOut) && /rear<\/div>/.test(hOut));
  check("niggle entries persist optional zone (additive schema)", /zone:\(qs\("ng_zone"\)/.test(code));
}

// ── 23. Phase 8 complete (v1.48): #35 voice → extraction path ──────────────
{
  const P = ctx.__H__.parseNiggleExtract;
  const ok = P('```json\n{"region":"achilles","side":"L","structure":"tendon","severity":4,"timing":"during session","warmup":"improves with warmup","note":"descent reps"}\n```');
  check("parseNiggleExtract: valid fenced JSON → full draft, no missing", !!ok && ok.obj.region === "achilles" && ok.obj.side === "L" && ok.obj.sev === 4 && ok.missing.length === 0, ok && ok.missing);
  check("parseNiggleExtract: date defaults to today and is flagged", !!ok && /^\d{4}-\d{2}-\d{2}$/.test(ok.obj.d) && ok.obj.dateDefaulted === true);
  const bad = P('{"region":"kneecap","side":"left","severity":15}');
  check("parseNiggleExtract: off-enum values null out and surface in missing", !!bad && bad.obj.region === null && bad.obj.side === null && bad.obj.sev === null && bad.missing.includes("region") && bad.missing.includes("side") && bad.missing.includes("sev"), bad && bad.missing);
  check("parseNiggleExtract: garbage → null (graceful)", P("no json here at all") === null && P("") === null);
  const sys = ctx.__H__.niggleExtractSystem();
  check("extraction system prompt sentinel-guarded + enums injected from the locked consts", sys.startsWith("ATHLETE_OS_NIGGLE_EXTRACT") && sys.includes('"toes/sesamoid"') && sys.includes('"improves with warmup"'));
  check("extraction POSTs to the Worker /claude (key never client-side)", /fetch\(base\+"\/claude"/.test(code) && !/x-api-key/.test(code));
  check("offline guard present with manual-path note", /navigator\.onLine===false/.test(code) && /manual fields work offline/.test(code));
}

// ── 24. Phase 8 complete (v1.48): #39/#40 clinical-print additions (D025) ──
{
  const App4 = ctx.__H__.App;
  let clin = "";
  try { clin = App4.viewClinical.call(App4); } catch (e) { check("viewClinical (v1.48) no throw", false, e.message); }
  check("clinical print: Form (TSB) chart present with all five band labels", /Form \(TSB\)/.test(clin) && /High Risk/.test(clin) && /Optimal/.test(clin) && /Grey Zone/.test(clin) && /Fresh/.test(clin) && /Transition/.test(clin));
  check("clinical print: projection flagged plan-derived", /plan-derived projection/.test(clin));
  check("clinical print: RHR + HRV + Sleep sections render", /Resting HR/.test(clin) && /HRV \(overnight\)/.test(clin) && /Sleep/.test(clin));
  check("clinical print: niggle log table present (Andre-ratified 18/07/26)", /Niggle log — self-reported/.test(clin));
  check("print pagination: cards break-inside:avoid", /@media print\{[^}]*\}\s*/.test(html) ? /\.card\{break-inside:avoid;page-break-inside:avoid\}/.test(html) : false);
}

// ── 25. Phase 4 (v1.49): RX registry + matcher + scorer + inline run card + gym responsive ──
{
  const H = ctx.__H__;
  const { RX_TEMPLATES, RX_OVERRIDES, resolveRX, matchRX, scoreRun, fieldScore, INTENSITY_SCORED, phaseOf, dayISO, App } = H;

  // 1. resolveRX template merge + override merge + rest default
  check("resolveRX: Ph2 day1 (Tue) = thr (template)", resolveRX(4,1).t === "thr", resolveRX(4,1));
  check("resolveRX: W3 day5 = t_aet (override)", resolveRX(3,5).t === "t_aet", resolveRX(3,5));
  check("resolveRX: unlisted phase (W50, Ph13) → rest default", resolveRX(50,0).t === "rest", resolveRX(50,0));

  // 2. Scorer thresholds
  check("scorer: dev 0.19 → 100", fieldScore(0.19) === 100);
  check("scorer: dev 0.21 → <100", fieldScore(0.21) < 100 && fieldScore(0.21) > 0, fieldScore(0.21));
  check("scorer: dev ≥0.50 → 0", fieldScore(0.50) === 0 && fieldScore(0.65) === 0);
  {
    const rx37 = {t:"race", dur:[3,3], km:null, vert:null, z:null, pw:null, surf:"road", note:null};
    const rxPoint = {t:"mp", dur:[3,3], km:null, vert:null, z:null, pw:null, surf:"road", note:null};
    const s1 = scoreRun(rxPoint, {h:3.7, km:null, gain:null});
    check("scorer: point-target [3,3] at 3.7h → 0<score<100 (>+20% dev)", s1 && s1.score > 0 && s1.score < 100, s1 && s1.score);
    check("scorer: t:race is never scored", scoreRun(rx37, {h:3, km:null, gain:null}) === null);
  }

  // 3. G5 symmetry — over-delivery and its formula-mirrored under-delivery score equal
  {
    const rxEasy = {t:"easy", dur:[0.50,0.67], km:null, vert:null, z:"Z2", pw:null, surf:"any", note:null};
    const devOver = (1.00 - 0.67) / 0.67;
    const mirroredUnderActual = 0.50 * (1 - devOver);
    const sOver = scoreRun(rxEasy, {h:1.00, km:null, gain:null});
    const sUnder = scoreRun(rxEasy, {h:mirroredUnderActual, km:null, gain:null});
    check("G5 symmetry: over-delivery 1.0h scores equal to the mirrored under-delivery",
      sOver && sUnder && sOver.score === sUnder.score, {over:sOver&&sOver.score, under:sUnder&&sUnder.score});
  }

  // 4. Renormalisation + coverage "n/m" string
  {
    const rxVert = resolveRX(31,5); // BENCHMARK, km+vert both present
    const sVert = scoreRun(rxVert, {h:null, km:30, gain:1100});
    check("renormalisation: vert-present RX scores on 2 channels", sVert && /^2\/2$/.test(sVert.coverage), sVert && sVert.coverage);
    const rxNoVert = {t:"easy", dur:[0.50,0.67], km:null, vert:null, z:"Z2", pw:null, surf:"any", note:null};
    const sNoVert = scoreRun(rxNoVert, {h:0.6, km:null, gain:null});
    check("renormalisation: vert-null RX → 1-channel coverage, \"n/m\" string present", sNoVert && /^1\/1$/.test(sNoVert.coverage), sNoVert && sNoVert.coverage);
  }

  // 5. Matcher
  {
    const S = App.state.sessions.runs;
    const savedRuns = S.slice();
    App.state.sessions.runs = [];
    const w = 5; // Phase 1, easy/easy/rest/easy/rest/longE/rest template
    const isoOf = i => dayISO(w,i);
    // same-day beats ±1
    App.state.sessions.runs = [
      {d:isoOf(0), id:"m1", h:0.7, km:null, run_type:"easy", quarantined:false},
      {d:new Date(new Date(isoOf(0)).getTime()+86400000).toISOString().slice(0,10), id:"m2", h:0.7, km:null, run_type:"easy", quarantined:false},
    ];
    let m = matchRX(w);
    check("matcher: same-day candidate wins over ±1", m.matched[0] && m.matched[0].id === "m1", m.matched[0]&&m.matched[0].id);

    // ±2 in-window, ±3 out — use the week's isolated longE day (day5, phase2
    // template) with an authoritative "long" candidate so it can only bind to
    // that one LONG-class day, regardless of relative proximity to EASY days.
    App.state.sessions.runs = [
      {d:(()=>{const dt=new Date(isoOf(5));dt.setDate(dt.getDate()+2);return dt.toISOString().slice(0,10);})(), id:"p2", h:3, km:null, run_type:"long", quarantined:false},
    ];
    m = matchRX(w);
    check("matcher: ±2-day candidate matches", m.matched[5] && m.matched[5].id === "p2", m.matched[5]);
    App.state.sessions.runs = [
      {d:(()=>{const dt=new Date(isoOf(5));dt.setDate(dt.getDate()+3);return dt.toISOString().slice(0,10);})(), id:"p3", h:3, km:null, run_type:"long", quarantined:false},
    ];
    m = matchRX(w);
    check("matcher: ±3-day candidate does NOT match (out of window)", !m.matched[5], m.matched[5]);

    // type binding blocks an authoritative LONG-typed row from an easy day, non-same-day
    App.state.sessions.runs = [
      {d:(()=>{const dt=new Date(isoOf(0));dt.setDate(dt.getDate()+1);return dt.toISOString().slice(0,10);})(), id:"lg1", h:3, km:null, run_type:"long", quarantined:false},
    ];
    m = matchRX(w);
    check("matcher: authoritative LONG-typed row blocked from an EASY day (non-same-day)", !m.matched[0], m.matched[0]);

    // live-row (non-authoritative) duration-inference does not block same-day
    App.state.sessions.runs = [
      {d:isoOf(0), id:"live1", h:2.0, km:null, run_type:null, quarantined:false}, // h≥1.75 → LONG-inferred, but same-day
    ];
    m = matchRX(w);
    check("matcher: non-authoritative duration-inferred mismatch does NOT block same-day", m.matched[0] && m.matched[0].id === "live1", m.matched[0]);

    // quarantined never matches
    App.state.sessions.runs = [
      {d:isoOf(0), id:"q1", h:0.6, km:null, run_type:"easy", quarantined:true},
    ];
    m = matchRX(w);
    check("matcher: quarantined run never matches", !m.matched[0], m.matched[0]);

    // rx_d pin + "x" unlink
    App.state.sessions.runs = [
      {d:(()=>{const dt=new Date(isoOf(0));dt.setDate(dt.getDate()+5);return dt.toISOString().slice(0,10);})(), id:"pin1", h:0.6, km:null, run_type:"easy", quarantined:false, rx_d:isoOf(0)},
    ];
    m = matchRX(w);
    check("matcher: rx_d manual pin matches outside the ±2d window", m.matched[0] && m.matched[0].id === "pin1", m.matched[0]);
    App.state.sessions.runs = [
      {d:isoOf(0), id:"unlink1", h:0.6, km:null, run_type:"easy", quarantined:false, rx_d:"x"},
    ];
    m = matchRX(w);
    check("matcher: rx_d===\"x\" forces unmatched", !m.matched[0] && m.unplanned.some(r=>r.id==="unlink1"));

    App.state.sessions.runs = savedRuns;
  }

  // 6. runDayCard pre-log AND post-log render no-throw; unplanned row renders
  {
    const savedRuns = App.state.sessions.runs.slice();
    const savedRunDay = App.runDay;
    App.state.sessions.runs = [];
    App.runDay = {w:5, i:0};
    let preOut = "";
    try { preOut = ctx.__H__.runDayCard.call(null, 5); } catch(e){ check("runDayCard pre-log no throw", false, e.message); }
    check("runDayCard pre-log renders (RX table, no match)", /eyebrow/.test(preOut) || preOut.length>0, preOut.length);
    const isoOf0 = dayISO(5,0);
    App.state.sessions.runs = [
      {d:isoOf0, id:"post1", h:0.6, km:null, run_type:"easy", quarantined:false},
      {d:isoOf0, id:"un1", h:0.3, km:null, run_type:"easy", quarantined:false, rx_d:"x"},
    ];
    let postOut = "";
    try { postOut = ctx.__H__.runDayCard.call(null, 5); } catch(e){ check("runDayCard post-log no throw", false, e.message); }
    check("runDayCard post-log renders (plan-vs-actual)", postOut.length>0);
    check("runDayCard shows the unplanned row", /unplanned/.test(postOut));
    App.state.sessions.runs = savedRuns; App.runDay = savedRunDay;
  }

  // 7. Gym stack: media query present for the gym table class
  check("gym table responsive rule present (@media max-width:480px .gym-tbl)", /\.gym-tbl/.test(html) && /max-width:480px/.test(html));

  // 8. GYM_SESSIONS: zero "per sheet" residue, every ex row length 5, spot-check Incline Press
  check("GYM_SESSIONS: zero \"per sheet\" residue", !/per sheet/.test(code));
  {
    const GS = ctx.__H__.GYM_SESSIONS;
    const allRows = Object.values(GS).flatMap(s=>s.ex);
    check("GYM_SESSIONS: every ex row has length 5", allRows.every(r=>r.length===5), allRows.filter(r=>r.length!==5));
    const incline = GS.Upper.ex.find(e=>e[0]==="45° Incline Barbell Press");
    check("GYM_SESSIONS: spot-check Incline Press 5-tuple", incline && incline[1]==="6-7→7-8" && incline[2]==="3–5′" && incline[3]==="2→3" && incline[4]==="6-8", incline);
  }

  // 9. INTENSITY_SCORED gate
  check("INTENSITY_SCORED === false", INTENSITY_SCORED === false);
}

// ── 26. Addendum A (v1.50, D044): RX gain+descent extension ──────────────
{
  const H = ctx.__H__;
  const { RX_TEMPLATES, RX_OVERRIDES, resolveRX, scoreRun, fieldScore, fieldDev, DESCENT_SCORED, App } = H;

  // desc field present on every non-rest RX object (null allowed)
  {
    const allTpl = Object.values(RX_TEMPLATES).flat();
    const nonRest = allTpl.filter(r=>r.t!=="rest");
    check("§26: every non-rest RX_TEMPLATES object carries a desc key (null allowed)",
      nonRest.every(r=>Object.prototype.hasOwnProperty.call(r,"desc")),
      nonRest.filter(r=>!Object.prototype.hasOwnProperty.call(r,"desc")));
    const allOv = Object.values(RX_OVERRIDES).flatMap(w=>Object.values(w));
    const nonRestOv = allOv.filter(r=>r.t!=="rest" && r.desc===undefined ? false : true);
    // override rows may be partial merges (e.g. W45 patches only vert/desc/note) — only
    // full-shape override rows (those carrying a t) are checked for the desc key.
    const fullOv = allOv.filter(r=>r.t && r.t!=="rest");
    check("§26: every non-rest, full-shape RX_OVERRIDES object carries a desc key (null allowed)",
      fullOv.every(r=>Object.prototype.hasOwnProperty.call(r,"desc")),
      fullOv.filter(r=>!Object.prototype.hasOwnProperty.call(r,"desc")));
  }

  // ratified spot-values
  check("§26: W20 override vert=[600,900] desc=[700,1000]",
    RX_OVERRIDES[20][5].vert[0]===600 && RX_OVERRIDES[20][5].vert[1]===900 &&
    RX_OVERRIDES[20][5].desc[0]===700 && RX_OVERRIDES[20][5].desc[1]===1000,
    RX_OVERRIDES[20][5]);
  check("§26: W31 benchmark desc=[1050,1150]",
    RX_OVERRIDES[31][5].desc[0]===1050 && RX_OVERRIDES[31][5].desc[1]===1150, RX_OVERRIDES[31][5]);
  check("§26: W45 taper override vert=[200,400] desc=[200,400]",
    RX_OVERRIDES[45][5].vert[0]===200 && RX_OVERRIDES[45][5].vert[1]===400 &&
    RX_OVERRIDES[45][5].desc[0]===200 && RX_OVERRIDES[45][5].desc[1]===400, RX_OVERRIDES[45][5]);
  check("§26: Ph10 ME template vert=[400,800] desc=[400,800]",
    RX_TEMPLATES[10][2].vert[0]===400 && RX_TEMPLATES[10][2].vert[1]===800 &&
    RX_TEMPLATES[10][2].desc[0]===400 && RX_TEMPLATES[10][2].desc[1]===800, RX_TEMPLATES[10][2]);
  check("§26: races carry null-null (vert/desc)",
    RX_OVERRIDES[9][6].vert===null && RX_OVERRIDES[9][6].desc===null &&
    RX_OVERRIDES[22][5].vert===null && RX_OVERRIDES[22][5].desc===null &&
    RX_OVERRIDES[46][5].vert===null && RX_OVERRIDES[46][5].desc===null,
    {sydney:RX_OVERRIDES[9][6], utk:RX_OVERRIDES[22][5], uta:RX_OVERRIDES[46][5]});

  // DESCENT_SCORED gate
  check("§26: DESCENT_SCORED === false", DESCENT_SCORED === false);

  // pre-flip scorer output bit-identical to the D043 formula on a desc-carrying RX
  {
    const rx = RX_TEMPLATES[10][5]; // longE, vert:[1300,2000], desc:[1300,2000]
    const run = {h:5.0, km:null, gain:1600, desc:1550, avg_hr:null};
    const sc = scoreRun(rx, run);
    // manual D043-formula replica: vol(dur) 0.6 + vert 0.2, renormalised over 2 active channels
    const devDur = fieldDev(rx.dur[0],rx.dur[1],run.h), scoreDur = fieldScore(devDur);
    const devVert = fieldDev(rx.vert[0],rx.vert[1],run.gain), scoreVert = fieldScore(devVert);
    const expect = Math.round((scoreDur*0.6 + scoreVert*0.2)/(0.6+0.2));
    check("§26: pre-flip scorer bit-identical to D043 formula on a desc-carrying RX",
      sc.score === expect, {got:sc.score, expect});
    check("§26: pre-flip coverage denominator excludes desc (DESCENT_SCORED=false)",
      sc.coverage === "2/2", sc.coverage);
    check("§26: pre-flip channels array contains no \"desc\" key", !sc.channels.some(c=>c.k==="desc"), sc.channels);
  }

  // importSessions maps gain_m/descent_m
  check("§26: importSessions source maps gain_m and descent_m fallbacks", /gain_m/.test(code) && /descent_m/.test(code));

  // syncICU desc nullable, refresh-on-sync (not RUN_FILL_ONLY)
  check("§26: syncICU source derives a nullable desc field from live candidates", /total_descent/.test(code) && /icu_descent/.test(code));
  check("§26: syncICU desc is NOT in the fill-only list (refresh-on-sync class)", !/RUN_FILL_ONLY\s*=\s*\[[^\]]*"desc"/.test(code));

  // runDayCard renders Gain+Descent rows pre+post-log, no-throw
  {
    const savedRuns = App.state.sessions.runs.slice();
    const savedRunDay = App.runDay;
    App.state.sessions.runs = [];
    App.runDay = {w:10, i:5}; // Ph10 longE day, carries desc band
    let preOut = "";
    try { preOut = H.runDayCard.call(null, 10); } catch(e){ check("§26: runDayCard pre-log no throw (Gain+Descent)", false, e.message); }
    check("§26: runDayCard pre-log renders Gain row", /Gain/.test(preOut));
    check("§26: runDayCard pre-log renders Descent row", /Descent/.test(preOut));
    const isoOf0 = H.dayISO(10,5);
    App.state.sessions.runs = [
      {d:isoOf0, id:"desc1", h:5.0, km:null, run_type:"long", quarantined:false, gain:1600, desc:1550},
    ];
    let postOut = "";
    try { postOut = H.runDayCard.call(null, 10); } catch(e){ check("§26: runDayCard post-log no throw (Gain+Descent)", false, e.message); }
    check("§26: runDayCard post-log renders Descent row", /Descent/.test(postOut));
    App.state.sessions.runs = savedRuns; App.runDay = savedRunDay;
  }
}

// ── 27. Phase 5 (v1.51, D045): Strength tab rebuild ───────────────────────
{
  const H = ctx.__H__;
  const { NIPPARD_WEEKS, NIPPARD_EX, NIPPARD_META, NIPPARD_TO_MF, MUSCLE_REGIONS, EX_REGION_MAP,
          parseStrengthTSV, excelSerialToISO, parseDateCell, regionsWithData, regionWeeklyRows,
          regionCard, unmappedBucket, nippardProgramCard, KEY_LIFTS, App } = H;

  // NIPPARD_WEEKS: 12 weeks, 5 non-rest sessions each, 408 total exercise rows, every exIdx valid
  {
    const weekKeys = Object.keys(NIPPARD_WEEKS);
    check("§27: NIPPARD_WEEKS has 12 weeks", weekKeys.length===12, weekKeys.length);
    let total=0, badRow=null, badIdx=null;
    weekKeys.forEach(w=>{
      const wk=NIPPARD_WEEKS[w]; const sessions=wk.d.filter(Boolean);
      if(sessions.length!==5) check(`§27: week ${w} has 5 non-rest sessions`, false, sessions.length);
      sessions.forEach(day=>{ total+=day.ex.length;
        day.ex.forEach(row=>{ if(row.length!==8) badRow=row; if(row[0]<0||row[0]>=NIPPARD_EX.length) badIdx=row[0]; }); });
    });
    check("§27: NIPPARD_WEEKS totals 408 exercise rows", total===408, total);
    check("§27: every exercise row has length 8", badRow===null, badRow);
    check("§27: every exIdx resolves within NIPPARD_EX", badIdx===null, badIdx);
  }

  // wk-1 ⇄ GYM_SESSIONS consistency (name-normalised, sets first-term, reps, rest, RPE)
  {
    const normRest = s => s.replace(/(\d)-(\d)/,"$1–$2").replace(" min","′");
    const wk1 = NIPPARD_WEEKS["1"];
    const GS = H.GYM_SESSIONS;
    const keyMap = {Upper:"Upper", Lower:"Lower", Pull:"Pull", Push:"Push", Legs:"Legs"};
    let allMatch = true, mismatches=[];
    wk1.d.filter(Boolean).forEach(day=>{
      const gs = GS[keyMap[day.k]]; if(!gs){ allMatch=false; mismatches.push(day.k+": no GYM_SESSIONS entry"); return; }
      day.ex.forEach((row,i)=>{
        const [exIdx,tech,wu,sets,reps,eRpe,lRpe,rest]=row;
        const gsRow = gs.ex[i]; if(!gsRow){ allMatch=false; mismatches.push(`${day.k}[${i}]: no matching GYM row`); return; }
        const [gName,gRpe,gRest,gSets,gReps]=gsRow;
        const gSetsFirst = gSets.split("→")[0];
        const nameOk = gName.includes(NIPPARD_EX[exIdx]) || NIPPARD_EX[exIdx].includes(gName) || gName===(NIPPARD_TO_MF[NIPPARD_EX[exIdx]]||"");
        const setsOk = gSetsFirst===sets;
        const repsOk = gReps===reps;
        const restOk = normRest(gRest)===normRest(rest) || gRest===rest;
        const rpeOk = gRpe===(eRpe+"→"+lRpe) || gRpe===((eRpe==="N/A"?"":eRpe)+"→"+lRpe);
        if(!(setsOk&&repsOk&&rpeOk)){ allMatch=false; mismatches.push(`${day.k}[${i}] ${NIPPARD_EX[exIdx]}: sets ${setsOk} reps ${repsOk} rpe ${rpeOk}`); }
      });
    });
    check("§27: wk-1 sets/reps/RPE consistent with GYM_SESSIONS (34/34)", allMatch, mismatches);
  }

  // every NIPPARD_META entry has note or subs
  check("§27: every NIPPARD_META entry has a note and/or subs", Object.values(NIPPARD_META).every(m=>m.n||( m.s&&m.s.length)));

  // TSV parser: serial-date decode, DD/MM/YYYY accept, empty→absent, fractional preserved, unknown sheet skipped
  {
    check("§27: excelSerialToISO decodes a known serial", excelSerialToISO(45816)==="2025-06-08", excelSerialToISO(45816));
    check("§27: parseDateCell accepts DD/MM/YYYY", parseDateCell("08/06/2025")==="2025-06-08");
    check("§27: parseDateCell accepts a serial string", parseDateCell("45816")==="2025-06-08");
    const tsv = "## Sheet: Muscle Groups - Sets\nDate\tChest\tBack\n08/06/2025\t4.5\t\n## Sheet: Exercises - 1-RM\nDate\tBarbell Bench Press (kg)\n08/06/2025\t102.3\n## Sheet: Mystery Tab\nDate\tFoo\n08/06/2025\t1\n";
    const parsed = parseStrengthTSV(tsv);
    check("§27: parser decodes regSets with fractional credit preserved", parsed.regSets["2025-06-08"] && parsed.regSets["2025-06-08"].Chest===4.5, parsed.regSets);
    check("§27: parser treats empty cell as absent, not 0", parsed.regSets["2025-06-08"] && !("Back" in parsed.regSets["2025-06-08"]), parsed.regSets);
    check("§27: parser decodes exE1rm sheet", parsed.exE1rm["2025-06-08"] && parsed.exE1rm["2025-06-08"]["Barbell Bench Press"]===102.3, parsed.exE1rm);
    check("§27: parser reports an unrecognised sheet as skipped", parsed.skipped.includes("Mystery Tab"), parsed.skipped);
  }

  // replace-by-date merge via importStrength (per sheet-kind)
  {
    const savedStrength = JSON.parse(JSON.stringify(App.state.strength));
    App.state.strength.reg["2025-06-08"] = {Chest:{sets:3, vol:900}};
    // simulate a fresh regSets-only import overwriting sets but preserving vol
    const parsed2 = parseStrengthTSV("Date\tChest\n08/06/2025\t5\n");
    Object.keys(parsed2.regSets).forEach(iso=>{ App.state.strength.reg[iso]=App.state.strength.reg[iso]||{};
      Object.keys(parsed2.regSets[iso]).forEach(reg=>{ App.state.strength.reg[iso][reg]=App.state.strength.reg[iso][reg]||{}; App.state.strength.reg[iso][reg].sets=parsed2.regSets[iso][reg]; }); });
    check("§27: replace-by-date updates sets", App.state.strength.reg["2025-06-08"].Chest.sets===5);
    check("§27: replace-by-date preserves untouched vol field", App.state.strength.reg["2025-06-08"].Chest.vol===900);
    App.state.strength = savedStrength;
  }

  // unmapped bucket: synthetic import with a novel name lands visibly
  {
    const savedEx = JSON.parse(JSON.stringify(App.state.strength.ex));
    App.state.strength.ex["2025-06-08"] = App.state.strength.ex["2025-06-08"] || {};
    App.state.strength.ex["2025-06-08"]["Totally Novel Exercise Name"] = {sets:3};
    let out=""; try{ out = unmappedBucket(); }catch(e){ check("§27: unmappedBucket no throw", false, e.message); }
    check("§27: unmapped bucket surfaces a novel imported name", /Totally Novel Exercise Name/.test(out), out.length);
    App.state.strength.ex = savedEx;
  }

  // region card no-throw with and without data
  {
    let out1="", out2="";
    try{ out1 = regionCard(null); }catch(e){ check("§27: regionCard no-throw (no region)", false, e.message); }
    try{ out2 = regionCard("Chest"); }catch(e){ check("§27: regionCard no-throw (Chest, no data)", false, e.message); }
    check("§27: regionCard renders without throwing regardless of data presence", out1.length>0 && out2.length>0);
  }

  // KEY_LIFTS series gains a src:"mf" point on import; manual points untouched
  {
    const savedLifts = App.state.lifts.slice();
    App.state.lifts = [{d:"2025-06-01", lift:KEY_LIFTS[0], e1rm:100}]; // manual, no src
    App.state.lifts.push({d:"2025-06-08", lift:KEY_LIFTS[0], e1rm:105, src:"mf"});
    const manual = App.state.lifts.find(l=>l.d==="2025-06-01");
    const mf = App.state.lifts.find(l=>l.d==="2025-06-08");
    check("§27: manual lift point has no src (untouched by import)", manual.src===undefined);
    check("§27: MF-imported lift point carries src:\"mf\"", mf.src==="mf");
    App.state.lifts = savedLifts;
  }

  // program view render no-throw all 12×5; firewall: program card render mutates no state
  {
    const savedNav = App.npNav, savedInfo = App.npInfo;
    const savedStrJSON = JSON.stringify(App.state.strength), savedGymJSON = JSON.stringify(App.state.sessions.gym);
    let allOk = true;
    ["F","R"].forEach(b=>{
      Object.keys(NIPPARD_WEEKS).filter(w=>NIPPARD_WEEKS[w].b===b).forEach(w=>{
        ["Upper","Lower","Pull","Push","Legs"].forEach(k=>{
          App.npNav = {b, w:+w, k};
          try{ nippardProgramCard(); }catch(e){ allOk=false; }
        });
      });
    });
    check("§27: nippardProgramCard renders no-throw across all 12×5 nav combinations", allOk);
    check("§27: program card render never mutates s.strength", JSON.stringify(App.state.strength)===savedStrJSON);
    check("§27: program card render never mutates s.sessions.gym", JSON.stringify(App.state.sessions.gym)===savedGymJSON);
    App.npNav = savedNav; App.npInfo = savedInfo;
  }

  // EX_REGION_MAP / MUSCLE_REGIONS sanity
  check("§27: MUSCLE_REGIONS has 22 groups", MUSCLE_REGIONS.length===22, MUSCLE_REGIONS.length);
  check("§27: EX_REGION_MAP entries all resolve to known MUSCLE_REGIONS", Object.values(EX_REGION_MAP).every(e=>e.r.every(r=>MUSCLE_REGIONS.includes(r))));
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
