/**
 * Kei CLI entry point.
 *
 * Parses argv, dispatches to the driver. Help/version handled here so the
 * driver only deals with actual compilation flags.
 *
 * Implementation lives in `cli/`:
 *   - cli/args.ts                 (argument parsing, help text)
 *   - cli/driver.ts               (pipeline orchestration)
 *   - cli/diagnostics-format.ts   (diagnostic rendering)
 *   - cli/ast-printer.ts          (--ast tree dump)
 */

import { parseArgs, printHelp, VERSION } from "./cli/args";
import { runDriver } from "./cli/driver";

const result = parseArgs(process.argv.slice(2));

if (result.kind === "help") {
  printHelp();
  process.exit(0);
} else if (result.kind === "version") {
  console.log(`kei ${VERSION}`);
  process.exit(0);
} else if (result.kind === "error") {
  console.error(`error: ${result.message}\n`);
  printHelp();
  process.exit(1);
} else {
  const code = await runDriver(result.flags);
  process.exit(code);
}
