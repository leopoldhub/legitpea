import {chromium} from "playwright";
import fs from "fs";
import path from "node:path";

const CACHE_DIR = "./cache";
const CACHE_OVERWRITE_DIR = "./cache_overwrite";

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR);
}

function getCachePath(resourcePath) {
  return path.join(CACHE_DIR, resourcePath);
}

function getCacheOverwritePath(resourcePath) {
  return path.join(CACHE_OVERWRITE_DIR, resourcePath);
}

async function onPageLoad(page) {
  if (fs.existsSync("./custom_style.css")) {
    await page.addStyleTag({
      content: fs.readFileSync("./custom_style.css", {encoding: "utf8"})
    });
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized",
      "--disable-infobars",
      "--app=about:blank"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
    viewport: null
  });

  context.route("**/*", async (route, request) => {
    console.log("r>", request.url());
    const parsedUrl = new URL(request.url());
    if (!["www.photopea.com", "photopea.com", "vecpea.com", "fonts.gstatic.com", "gstatic.com"].includes(parsedUrl.hostname)) {
      route.abort();
      console.log("r>", request.url(), "blocked!");
      return;
    }
    try {
      const resourceFolder = path.join(path.normalize(parsedUrl.hostname), path.normalize(path.parse(parsedUrl.pathname).dir));
      const resourceFile = path.join(resourceFolder, path.parse(parsedUrl.pathname).base || "index.html");
      const resourceHeadersFile = resourceFile + "__response_headers";


      if (fs.existsSync(getCacheOverwritePath(resourceFile)) && fs.existsSync(getCacheOverwritePath(resourceHeadersFile))) {
        console.log("r>", request.url(), "overwrite resource found!");
        if (!fs.existsSync(getCachePath(resourceFile)) || !fs.lstatSync(getCachePath(resourceFile)).isFile()) {
          const res = await route.fetch();
          if (!fs.existsSync(getCachePath(resourceFolder))) {
            fs.mkdirSync(getCachePath(resourceFolder), {recursive: true});
          }
          fs.writeFileSync(getCachePath(resourceFile), await res.body(), {flag: "w"});
          fs.writeFileSync(getCachePath(resourceHeadersFile), JSON.stringify(res.headers()), {flag: "w"});
        }
        const res = {
          body: fs.readFileSync(getCacheOverwritePath(resourceFile))
        };
        if (fs.existsSync(getCacheOverwritePath(resourceHeadersFile)) && fs.lstatSync(getCacheOverwritePath(resourceHeadersFile)).isFile()) {
          res.headers = JSON.parse(fs.readFileSync(getCacheOverwritePath(resourceHeadersFile), {encoding: "utf8"}));
        }
        await route.fulfill(res);
        return;
      }
      if (fs.existsSync(getCachePath(resourceFile)) && fs.existsSync(getCachePath(resourceHeadersFile))) {
        console.log("r>", request.url(), "resource found!");
        route.fulfill({
          body: fs.readFileSync(getCachePath(resourceFile)),
          headers: JSON.parse(fs.readFileSync(getCachePath(resourceHeadersFile), {encoding: "utf8"}))
        });
        return;
      }

      console.log("r>", request.url(), "caching...");
      const res = await route.fetch();
      fs.mkdirSync(getCachePath(resourceFolder), {recursive: true});
      fs.writeFileSync(getCachePath(resourceFile), await res.body(), {flag: "w"});
      fs.writeFileSync(getCachePath(resourceHeadersFile), JSON.stringify(res.headers()), {flag: "w"});
      route.fulfill({
        body: await res.body(),
        headers: res.headers()
      });
    } catch (error) {
      console.error(error);
    }
  });

  const page = await context.newPage();

  if (!fs.existsSync(path.join(CACHE_DIR, "vecpea.com/rsrc/fonts/fs/")) && !fs.existsSync(path.join(CACHE_OVERWRITE_DIR, "vecpea.com/rsrc/fonts/fs/"))) {
    console.log("==== Downloading fonts ====");
    await page.addInitScript(({fonts, langs}) => {
      let langsFetchIndex = 0;
      let fontsFetchIndex = 0;

      async function ln() {
        try {
          await fetch(langs[langsFetchIndex++]);
        } catch (_) {
          console.error(_);
        }
        if (langsFetchIndex < langs.length) {
          setTimeout(ln, 0);
        }
      }

      async function ff() {
        try {
          await fetch(fonts[fontsFetchIndex++]);
        } catch (_) {
          console.error(_);
        }
        if (fontsFetchIndex < fonts.length) {
          setTimeout(ff, 0);
        }
      }

      ln();

      ff();
    }, {
      fonts: JSON.parse(fs.readFileSync("./fonts.json", "utf8")),
      langs: JSON.parse(fs.readFileSync("./langs.json", "utf8"))
    });
  }

  await page.addInitScript(() => {
    localStorage.setItem("_ppp", "{\"capShown\":\"false\",\"_ltools\":\"0\"}");
  });

  await page.goto("https://www.photopea.com/", {timeout: 1000000});

  await onPageLoad(page);

  page.on("framenavigated", async () => {
    await onPageLoad(page);
  });

  await page.waitForLoadState("networkidle", {timeout: 1000000});

  page.on("close", async () => {
    console.log("App window closed. Shutting down...");
    await context.close();
    await browser.close();
    process.exit(0);
  });

  console.log("==== Page, fonts and langs downloaded! ====");

})();
