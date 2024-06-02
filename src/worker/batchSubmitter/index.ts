import { initORM, finalizeORM } from '../../worker/batchSubmitter/db'
import { executorLogger as logger } from '../../lib/logger'
import { BatchSubmitter } from './batchSubmitter'
import { initServer, finalizeServer, initMetricsServer } from '../../loader'
import { batchController, metricsController } from '../../controller'
import { once } from 'lodash'
import { config } from '../../config'
import {isInvokedFromEntrypoint} from "../../entrypoint"

let jobs: BatchSubmitter[] = []

async function runBot(): Promise<void> {
  jobs = [new BatchSubmitter()]

  try {
    await Promise.all(
      jobs.map((job) => {
        job.run()
      })
    )
  } catch (err) {
    logger.error(`failed running bot`, err)
    stopBatch()
  }
}

function stopBot(): void {
  jobs.forEach((job) => job.stop())
}

export async function stopBatch(): Promise<void> {
  stopBot()

  logger.info('Closing listening port')
  finalizeServer()

  logger.info('Closing DB connection')
  await finalizeORM()

  logger.info('Finished Batch')
  process.exit(0)
}

export async function startBatch(): Promise<void> {
  await initORM()

  await initServer(batchController, config.BATCH_PORT)
  await initMetricsServer(metricsController, config.BATCH_METRICS_PORT)

  if (!config.ENABLE_API_ONLY) {
    await runBot()
  }

  // attach graceful shutdown
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const
  signals.forEach((signal) => process.on(signal, once(stopBatch)))
}

// start right away is the main module and not invoked from the entrypoint
if (!isInvokedFromEntrypoint(module) && require.main === module) {
  startBatch().catch(console.log)
}
