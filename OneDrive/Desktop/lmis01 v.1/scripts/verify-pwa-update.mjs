// Verifies (1) standalone launch shows no Landing content and (2) a new deployment is detected,
// activated, and the page reloads exactly once, with old LSMIS caches removed.
import { spawn, execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LANDING_TEXT = "Issuance of official Meat Inspection Certificate";

const port = 9800 + Math.floor(Math.random() * 100);
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "lsmisU"));
const proc = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `const _m=window.matchMedia.bind(window);window.matchMedia=(q)=>/display-mode:\\s*standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:_m(q);`,
});
await send("Page.navigate", { url: BASE + "/?source=pwa" });
await sleep(7000);

console.log("STANDALONE launch:", JSON.stringify({
  path: await ev("location.pathname"),
  loginForm: await ev("!!document.querySelector('input[type=password]')"),
  landingTextPresent: await ev(`document.body.innerText.includes(${JSON.stringify(LANDING_TEXT)})`),
  downloadAppTextPresent: await ev("/Download App/i.test(document.body.innerText)"),
  cachesBefore: await ev("caches.keys()"),
}));

// Mark the page so we can tell whether it reloaded
await ev("window.__lsmisMarker = 'original-page'; true");
console.log("Deploying new build...");
execSync("npx vite build", { stdio: "ignore" });
await sleep(1000);

await ev("navigator.serviceWorker.getRegistration().then(r => r.update()).then(()=>true)");
await sleep(3000);
console.log("After deploy, before user accepts:", JSON.stringify({
  bannerShown: await ev("!!document.getElementById('lsmis-update-banner')"),
  waiting: await ev("navigator.serviceWorker.getRegistration().then(r => !!r.waiting)"),
  stillOriginalPage: (await ev("window.__lsmisMarker")) === "original-page",
}));

await ev("document.querySelector('#lsmis-update-banner button')?.click(); true");
await sleep(6000);
console.log("After pressing Update:", JSON.stringify({
  reloaded: (await ev("window.__lsmisMarker")) !== "original-page",
  caches: await ev("caches.keys()"),
  waiting: await ev("navigator.serviceWorker.getRegistration().then(r => !!r.waiting)"),
  path: await ev("location.pathname"),
}));
ws.close(); proc.kill(); process.exit(0);

