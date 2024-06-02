// `entrypoint.ts` acts as the main entrypoint for the worker processes.
// Instead of treating each worker as a separate entrypoint,
// we can consolidate the worker processes into a single entrypoint.
// This has the benefit of reducing the number and size of build artifacts.

import { startExecutor } from './worker/bridgeExecutor'
import { startBatch } from './worker/batchSubmitter'
import { startChallenger } from './worker/challenger'
import { startOutput } from './worker/outputSubmitter'

const modeToEntrypointMap: Record<string, () => Promise<void>> = {
    executor: startExecutor,
    batch: startBatch,
    challenger: startChallenger,
    output: startOutput,
}

// utility function to determine if the module is invoked from the entrypoint.
// it checks if the module is the main module and if the filename includes "entrypoint",
// which will always be:
// - true for bundle
// - false for individual worker files
//
// NOTE: this needs to be a function instead of const, as it needs to be hoisted
export function isInvokedFromEntrypoint(module: NodeJS.Module | undefined): boolean {
    return (require.main === module && module?.filename.includes("entrypoint")) || false
}

const entrypoint = (mode: string): Promise<void> => {
    return Promise.resolve()
        .then(() => modeToEntrypointMap[mode] || Promise.reject(`unknown mode: ${mode}, available options = ${Object.keys(modeToEntrypointMap)}`))
        .then(workerFn => workerFn())

        // sink any rejection to console.error, and exit with code 127 (command not found)
        .catch(e => {
            console.error(e)
            process.exit(127)
        })
}
// -------------------------------------
;(async() => isInvokedFromEntrypoint(module) && entrypoint(process.env.WORKER_NAME || process.argv[2]))()
