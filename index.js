require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------
// TEST ROUTE
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Automation backend running." });
});

// ------------------------------------------------------------
// MAIN ROUTE
// ------------------------------------------------------------
app.post("/api/analyze", async (req, res) => {
  console.log("\n================ NEW JOB ================\n");
  console.log("Payload:", req.body);

  const { clientName, skin, hair, eyes, gender = "F" } = req.body;

  if (!clientName || !skin || !hair || !eyes) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // ------------------------------------------------------------
    // LOGIN
    // ------------------------------------------------------------
    await page.goto(process.env.JEUNIQUE_URL, { waitUntil: "domcontentloaded" });

    await page.fill('input[name="account"]', process.env.JEUNIQUE_USERNAME);
    await page.fill('input[name="psword"]', process.env.JEUNIQUE_PASSWORD);

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.click('input[type="submit"]'),
    ]);

    console.log("✅ Logged in successfully.");

    // ------------------------------------------------------------
    // GET FRAMES
    // ------------------------------------------------------------
    console.log("🔍 Locating frames…");

    // Menu frame = top frame (contains Color Alliance)
    let menuFrame = page.frame({ name: "Menu" });

    // Body frame = bottom frame
    let bodyFrame = page.frame({ name: "Body" });

    if (!menuFrame) {
      await page.waitForSelector('frame[name="Menu"]');
      menuFrame = page.frame({ name: "Menu" });
    }

    if (!bodyFrame) {
      await page.waitForSelector('frame[name="Body"]');
      bodyFrame = page.frame({ name: "Body" });
    }

    console.log("🪟 Frames loaded.");

    // ------------------------------------------------------------
    // CLICK COLOR ALLIANCE (inside Menu frame)
    // ------------------------------------------------------------
    console.log("🎯 Clicking 'Color Alliance' inside MENU FRAME…");

    await menuFrame.waitForSelector("a.mainmenu", { timeout: 15000 });

    await menuFrame.getByRole("link", { name: "Color Alliance" })
      .click()
      .catch(() => {});

    // Fallback JS inside menu frame
    await menuFrame.evaluate(() => {
      if (typeof showTable === "function") showTable("BFAS");
    });

    // Wait for submenu to become visible
    await menuFrame.waitForSelector("#BFAS", {
      state: "visible",
      timeout: 15000,
    });

    console.log("✅ Color Alliance opened!");

    // ------------------------------------------------------------
    // CLICK LET’S DO COLOR (inside Menu frame)
    // ------------------------------------------------------------
    console.log("🎨 Clicking 'Let's Do Color'…");

    await Promise.all([
      bodyFrame.waitForNavigation({ waitUntil: "domcontentloaded" }),
      menuFrame.getByRole("link", { name: /Let's Do Color/i }).click(),
    ]);

    console.log("📄 Form loaded.");

    // Refresh body frame
    bodyFrame = page.frame({ name: "Body" });

    // ------------------------------------------------------------
    // FILL FORM (inside Body frame)
    // ------------------------------------------------------------
    await bodyFrame.waitForSelector('input[name="cname"]', { timeout: 15000 });

    console.log("✏️ Filling form…");
    await bodyFrame.fill('input[name="cname"]', clientName);
    await bodyFrame.selectOption('select[name="sex"]', gender);
    await bodyFrame.fill('input[name="skin"]', skin);
    await bodyFrame.fill('input[name="hair"]', hair);
    await bodyFrame.fill('input[name="eye"]', eyes);

    // ------------------------------------------------------------
    // SUBMIT FORM
    // ------------------------------------------------------------
    console.log("📤 Submitting…");

    await Promise.all([
      bodyFrame.waitForNavigation({ waitUntil: "networkidle" }),
      bodyFrame.click('input[type="submit"][value="Let\'s Do Color Alliance"]'),
    ]);

    console.log("🔍 Extracting result…");

    await bodyFrame.waitForSelector('font[color="darkblue"]', { timeout: 20000 });

    // Collect all matching font elements' inner texts
    const allResults = await bodyFrame.locator('font[color="darkblue"]').allInnerTexts();

    // Default result (keep previous behavior if present)
    const defaultResult = (allResults[2] || allResults[0] || "").trim();

    // Try to find a human-friendly season label (e.g., TRUE LUMINANT SUMMER)
    // Heuristic: prefer elements that are all-caps and contain multiple words
    const seasonRegex = /^[\s]*([A-Z]{3,}(?:\s+[A-Z]{3,})+)[\s]*$/;
    let label = "";
    for (const t of allResults) {
      const txt = (t || "").trim();
      const m = txt.match(seasonRegex);
      if (m) {
        label = m[1].trim();
        break;
      }
    }
    if (!label) {
      // Fallbacks: prefer last element if it looks like a short label, otherwise use default
      const last = (allResults.length && allResults[allResults.length - 1].trim()) || "";
      if (/^[A-Z\s]{4,}$/.test(last)) {
        label = last;
      } else {
        label = defaultResult;
      }
    }

    console.log("🎉 RESULT =", defaultResult);
    console.log("🏷️ LABEL =", label);

    return res.json({
      success: true,
      result: defaultResult,
      label,
      raw: allResults,
    });

  } catch (err) {
    console.log("❌ ERROR:", err.message);

    try {
      const screenshot = await page.screenshot();
      fs.writeFileSync("error.png", screenshot);
      console.log("📸 Error screenshot saved: error.png");
    } catch {}

    return res.status(500).json({
      success: false,
      error: err.message,
    });

  } finally {
    if (browser) await browser.close();
  }
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 Running at http://localhost:${PORT}`);
});
