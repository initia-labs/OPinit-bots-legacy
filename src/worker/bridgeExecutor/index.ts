import { RPCClient } from '../../lib/rpc'
import { L1Monitor } from './monitor/l1'
import { L2Monitor } from './monitor/l2'
import { executorController, metricsController } from '../../controller'

import { executorLogger as logger } from '../../lib/logger'
import { initORM, finalizeORM } from './db'
import { initServer, finalizeServer, initMetricsServer } from '../../loader'
import { once } from 'lodash'
import { config, isInvokedFromEntrypoint } from '../../config'

let monitors

async function runBot(): Promise<void> {
  monitors = [
    new L1Monitor(new RPCClient(config.L1_RPC_URI, logger), logger),
    new L2Monitor(new RPCClient(config.L2_RPC_URI, logger), logger)
  ]
  try {
    await Promise.all(
      monitors.map((monitor) => {
        monitor.run()
      })
    )
  } catch (err) {
    logger.error(`failed running bot`, err)
    stopExecutor()
  }
}

async function stopBot(): Promise<void> {
  await Promise.all(
    monitors.map((monitor) => {
      monitor.stop()
    })
  )
}

export async function stopExecutor(): Promise<void> {
  await stopBot()

  logger.info('Closing listening port')
  finalizeServer()

  logger.info('Closing DB connection')
  await finalizeORM()

  logger.info('Finished Executor')
  process.exit(0)
}

export async function startExecutor(): Promise<void> {
  try {
    await initORM()

    await initServer(executorController, config.EXECUTOR_PORT)
    await initMetricsServer(metricsController, config.EXECUTOR_METRICS_PORT)

    if (!config.ENABLE_API_ONLY) {
      await runBot()
    }
  } catch (err) {
    throw new Error(err)
  }

  // attach graceful shutdown
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const
  signals.forEach((signal) => process.on(signal, once(stopExecutor)))
}

// start right away is the main module and not invoked from the entrypoint
if (!isInvokedFromEntrypoint(module) && require.main === module) {
  startExecutor().catch(console.log)
}

export { monitors }
