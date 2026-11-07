// Holdfast demo-mode end-to-end check via stock Chrome + puppeteer-core.
// Run with: node /tmp/holdfast-e2e.mjs
import puppeteer from "puppeteer-core";

const URL = "http://localhost:4173/";
const shot = (name) => `/tmp/holdfast-${name}.png`;
let failures = 0;

function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

async function setInputInSection(page, heading, placeholder, value) {
  await page.evaluate((h, ph, val) => {
    const section = Array.from(document.querySelectorAll("section")).find((s) => {
      const h2 = s.querySelector("h2");
      return h2 && h2.textContent.trim() === h;
    });
    if (!section) throw new Error(`no section headed ${h}`);
    const el = Array.from(section.querySelectorAll("input")).find(
      (i) => i.getAttribute("placeholder") === ph,
    );
    if (!el) throw new Error(`no input with placeholder ${ph} in ${h}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, heading, placeholder, value);
}

async function setInput(page, placeholder, value) {
  await page.evaluate((ph, val) => {
    const el = Array.from(document.querySelectorAll("input")).find(
      (i) => i.getAttribute("placeholder") === ph,
    );
    if (!el) throw new Error(`no input with placeholder ${ph}`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, placeholder, value);
}

async function clickButton(page, text) {
  await page.evaluate((t) => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.trim().includes(t),
    );
    if (!btn) throw new Error(`no button with text ${t}`);
    btn.click();
  }, text);
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/opt/google/chrome/chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=390,844"],
  defaultViewport: { width: 390, height: 844 },
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });
  // Wallet connect tries init() with a 4s timeout, then falls back to demo.
  await sleep(6000);

  let text = await bodyText(page);
  check("app mounts with Holdfast title", text.includes("Holdfast"));
  check("problem line shown", text.includes("People set money rules for themselves"));
  check("demo mode badge shown", text.includes("Demo mode"));
  check("create jar form shown", text.includes("Create your jar"));

  // Create a jar: name "New phone", goal 500, currency NIM (default).
  await setInput(page, "New phone", "New phone");
  await clickButton(page, "Create jar");
  await sleep(800);
  text = await bodyText(page);
  check("jar created, name shown", text.includes("New phone"));
  check("jar balance starts at 0.00 NIM", text.includes("0 NIM"));
  check("rules section shown", text.includes("Your rules, in plain words"));

  // Deposit 100 (demo, simulated).
  await setInput(page, "Amount in NIM", "100");
  await clickButton(page, "Deposit");
  await sleep(1000);
  text = await bodyText(page);
  check("deposit raises balance to 100.00 NIM", text.includes("100 NIM"));
  check("ledger records the deposit", text.includes("Deposited 100 NIM"));

  // Blocked withdrawal: 25 is over the per-withdrawal cap of 20.
  await setInputInSection(page, "Withdraw", "Amount in NIM", "25");
  await setInputInSection(page, "Withdraw", "NQ...", "0x0000000000000000000000000000000000000002");
  await clickButton(page, "Withdraw");
  await sleep(800);
  text = await bodyText(page);
  check(
    "over-cap withdrawal blocked with plain-words reason",
    text.includes("over the per-withdrawal cap of 20"),
  );
  check("ledger records the block", text.includes("Withdrawal of 25 NIM to") && text.includes("over the per-withdrawal cap of 20"));

  // Above-threshold withdrawal: 15 is above the confirm threshold of 10.
  await setInputInSection(page, "Withdraw", "Amount in NIM", "15");
  await setInputInSection(page, "Withdraw", "NQ...", "0x0000000000000000000000000000000000000002");
  await clickButton(page, "Withdraw");
  await sleep(800);
  text = await bodyText(page);
  check("confirmation panel appears", text.includes("above your confirm threshold of 10"));
  await clickButton(page, "Yes, withdraw it");
  await sleep(1000);
  text = await bodyText(page);
  check("confirmed withdrawal lowers balance to 85.00 NIM", text.includes("85 NIM"));
  check("ledger records the withdrawal", text.includes("Withdrew 15 NIM"));

  // Rule change: lower the per-withdrawal cap to 5 and confirm it is enforced.
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const cap = inputs.find((i) => i.value === "20");
    if (!cap) throw new Error("cap input not found");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(cap, "15");
    cap.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickButton(page, "Save rules");
  await sleep(800);
  text = await bodyText(page);
  check("rule change saved", text.includes("Rules saved"));
  check("ledger records the rule change", text.includes("Rules updated"));

  await page.screenshot({ path: shot("final"), fullPage: true });
  console.log(`console/page errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ${e}`));
  if (errors.length > 0) failures++;
} finally {
  await browser.close();
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All demo-mode checks passed.");
