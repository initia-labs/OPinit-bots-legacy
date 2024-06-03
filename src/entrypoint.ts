// `entrypoint.ts` acts as the main entrypoint for the worker processes.
// Instead of treating each worker as a separate entrypoint,
// we can consolidate the worker processes into a single entrypoint.
// This has the benefit of reducing the number and size of build artifacts.

import { startExecutor } from './worker/bridgeExecutor'
import { startBatch } from './worker/batchSubmitter'
import { startChallenger } from './worker/challenger'
import { startOutput } from './worker/outputSubmitter'
import { isInvokedFromEntrypoint } from './config'

const modeToEntrypointMap: Record<string, () => Promise<void>> = {
  executor: startExecutor,
  batch: startBatch,
  challenger: startChallenger,
  output: startOutput
}

const entrypoint = (mode: string): Promise<void> => {
  return (
    Promise.resolve()
      .then(() => console.log('Starting worker in mode:', mode))
      .then(
        () =>
          modeToEntrypointMap[mode] ||
          Promise.reject(
            `unknown mode: ${mode}, available options = ${Object.keys(modeToEntrypointMap)}`
          )
      )
      .then((workerFn) => workerFn())

      // sink any rejection to console.error, and exit with code 127 (command not found)
      .catch((e) => {
        console.error(e)
        process.exit(127)
      })
  )
};
// -------------------------------------
(async () =>
  isInvokedFromEntrypoint(module) &&
  entrypoint(process.env.WORKER_NAME || process.argv[2]))()
