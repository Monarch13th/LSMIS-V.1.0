// Removes the downloadable APK (public/downloads) from the Capacitor Android assets so the APK
// does not contain a copy of itself. The website still serves /downloads/* from dist/.
import fs from "fs";
import path from "path";

const target = path.resolve("android", "app", "src", "main", "assets", "public", "downloads");
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log("Removed", target);
} else {
  console.log("Nothing to remove:", target);
}

