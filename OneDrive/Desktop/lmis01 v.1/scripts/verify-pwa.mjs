// Headless Edge verification via Chrome DevTools Protocol (no extra dependencies).
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(label, { standalone, userDir, url }) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(EDGE, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    "--no-first-run", "--disable-gpu", "about:blank",
  ], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await send("Page.enable");
  if (standalone) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `const _m=window.matchMedia.bind(window);window.matchMedia=(q)=>/display-mode:\\s*standalone/.test(q)?{matches:true,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}:_m(q);`,
    });
  }
  await send("Page.navigate", { url });
  await sleep(6000);
  const out = {
    label,
    path: await evalJs("location.pathname + location.search"),
    hasLandingHero: await evalJs("!!document.querySelector('.landing-page, .landing-hero, [class*=landing]')"),
    hasLoginForm: await evalJs("!!document.querySelector('input[type=password]')"),
    standaloneMatch: await evalJs("matchMedia('(display-mode: standalone)').matches"),
    swController: await evalJs("!!navigator.serviceWorker.controller"),
    swRegistered: await evalJs("navigator.serviceWorker.getRegistration().then(r=>!!r&&!!(r.active||r.installing||r.waiting))"),
    caches: await evalJs("caches.keys()"),
    manifest: await evalJs("fetch('/manifest.webmanifest').then(r=>r.json()).then(j=>j.start_url+' | icons='+j.icons.length)"),
  };
  console.log(JSON.stringify(out));
  ws.close(); proc.kill();
  await sleep(500);
}

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));
await run("A. Browser tab, no session", { standalone: false, userDir: tmp("lsmisA"), url: BASE + "/" });
await run("B. Installed PWA (standalone), no session, start_url", { standalone: true, userDir: tmp("lsmisB"), url: BASE + "/?source=pwa" });
process.exit(0);

