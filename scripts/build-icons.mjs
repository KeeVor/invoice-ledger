import { chromium } from "playwright-core";
import fs from "node:fs/promises";

// One vector source for the UI, executable, installer and shortcuts.
const source = await fs.readFile("src/assets/piaoji.svg", "utf8");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${source}`,
  );
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of [...sizes, 512]) {
    await page.setViewportSize({ width: size, height: size });
    const png = await page.screenshot({ omitBackground: true });
    if (size === 512) await fs.writeFile("build/icon.png", png);
    else images.push(png);
  }
  const directory = Buffer.alloc(6 + sizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    directory[entry] = sizes[index] % 256;
    directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await fs.writeFile("build/icon.ico", Buffer.concat([directory, ...images]));
  console.log("Generated PNG and seven-resolution ICO from piaoji.svg");
} finally {
  await browser.close();
}
