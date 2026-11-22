// Runs the Android project's Gradle wrapper on any OS:
//   node scripts/gradle.mjs :engine:test :fft:test
// Windows needs gradlew.bat (and a shell to run .bat files); macOS/Linux use ./gradlew.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../apps/customer-android/", import.meta.url));
const windows = process.platform === "win32";
const result = spawnSync(windows ? "gradlew.bat" : "./gradlew", [...process.argv.slice(2), "--no-daemon"], {
  cwd,
  stdio: "inherit",
  shell: windows,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);