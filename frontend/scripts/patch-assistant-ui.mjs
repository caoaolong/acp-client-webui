import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(
  root,
  "node_modules/@assistant-ui/react/dist/context/react/utils/createContextStoreHook.js",
);
const source = join(root, "patches/createContextStoreHook.js");

if (!existsSync(target)) {
  console.warn("[patch-assistant-ui] skip: @assistant-ui/react not installed");
  process.exit(0);
}

copyFileSync(source, target);
console.log("[patch-assistant-ui] applied createContextStoreHook fix (#4398)");
