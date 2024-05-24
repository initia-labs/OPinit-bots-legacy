import { LCDClient as LCDClientL1 } from 'initia-l1'
import { LCDClient as LCDClientL2 } from 'initia-l2'
import { validateCelestiaConfig } from './celestia/utils'
import * as dotenv from 'dotenv'

const envFile =
  process.env.NODE_ENV === 'test' || !process.env.WORKER_NAME
    ? `.env`
    : `.env.${process.env.WORKER_NAME}`

console.log('activate ', envFile)
dotenv.config({ path: envFile })

const {
  EXECUTOR_PORT,
  BATCH_PORT,
  EXECUTOR_METRICS_PORT,
  OUTPUT_METRICS_PORT,
  BATCH_METRICS_PORT,
  L1_LCD_URI,
  L1_RPC_URI,
  L2_LCD_URI,
  L2_RPC_URI,
  BATCH_LCD_URI,
  BATCH_CHAIN_RPC_URI,
  BATCH_GAS_PRICES,
  BATCH_DENOM,
  BATCH_CHAIN_ID,

  CELESTIA_NAMESPACE_ID,

  PUBLISH_BATCH_TARGET,
  EXECUTOR_URI,
  BRIDGE_ID,
  OUTPUT_SUBMITTER_MNEMONIC,
  EXECUTOR_MNEMONIC,
  BATCH_SUBMITTER_MNEMONIC,
  CHALLENGER_MNEMONIC,
  USE_LOG_FILE,
  L2_GAS_PRICES,
  L1_CHAIN_ID,
  L2_CHAIN_ID,
  L1_CLIENT_ID,
  SLACK_WEB_HOOK,
  SUBMISSION_INTERVAL,
  SUBMISSION_THRESHOLD,
  FINALIZATION_PERIOD,
  IBC_METADATA,
  DELETE_OUTPUT_PROPOSAL,
  SLACK_NOT_ENOUGH_BALANCE_THRESHOLD,
  EXECUTOR_L1_MONITOR_HEIGHT,
  EXECUTOR_L2_MONITOR_HEIGHT,
  BATCH_SUBMITTER_ADDR,
  ENABLE_API_ONLY,
  ENABLE_ORACLE,

  // prometheus
  PROMETHEUS_METRICS_MODE,
  PROMETHEUS_GATEWAY_URI,
  PROMETHEUS_TIME_OUT
} = process.env

const supportedPublishBatchTargets = ['l1', 'celestia']

export const config = {
  EXECUTOR_PORT: EXECUTOR_PORT ? parseInt(EXECUTOR_PORT) : 5000,
  BATCH_PORT: BATCH_PORT ? parseInt(BATCH_PORT) : 5001,
  EXECUTOR_METRICS_PORT: EXECUTOR_METRICS_PORT
    ? parseInt(EXECUTOR_METRICS_PORT)
    : 8080,
  OUTPUT_METRICS_PORT: OUTPUT_METRICS_PORT
    ? parseInt(OUTPUT_METRICS_PORT)
    : 8081,
  BATCH_METRICS_PORT: BATCH_METRICS_PORT ? parseInt(BATCH_METRICS_PORT) : 8082,
  L1_LCD_URI: L1_LCD_URI ? L1_LCD_URI.split(',') : ['http://127.0.0.1:1317'],
  L1_RPC_URI: L1_RPC_URI ? L1_RPC_URI.split(',') : ['http://127.0.0.1:26657'],
  L2_LCD_URI: L2_LCD_URI ? L2_LCD_URI.split(',') : ['http://127.0.0.1:1317'],
  L2_RPC_URI: L2_RPC_URI ? L2_RPC_URI.split(',') : ['http://127.0.0.1:26657'],
  BATCH_LCD_URI: () => {
    if (process.env.WORKER_NAME !== 'batch') {
      return undefined
    }
    if (!PUBLISH_BATCH_TARGET || PUBLISH_BATCH_TARGET == 'l1') {
      return L1_LCD_URI
    } else if (BATCH_LCD_URI == undefined || BATCH_LCD_URI.length == 0) {
      throw Error(
        'Please check your configuration; BATCH_LCD_URI is needed but not given.'
      )
    }
  },
  BATCH_CHAIN_RPC_URI: (() => {
    if (process.env.WORKER_NAME !== 'batch') {
      return undefined
    }
    if (!PUBLISH_BATCH_TARGET || PUBLISH_BATCH_TARGET == 'l1') {
      return L1_RPC_URI
    } else if (
      BATCH_CHAIN_RPC_URI == undefined ||
      BATCH_CHAIN_RPC_URI.length == 0
    ) {
      throw Error(
        'Please check your configuration; BATCH_CHAIN_RPC_URI is needed but not given.'
      )
    }
  })(),
  CELESTIA_NAMESPACE_ID: CELESTIA_NAMESPACE_ID || '',
  PUBLISH_BATCH_TARGET: (() => {
    if (PUBLISH_BATCH_TARGET === undefined) {
      return 'l1'
    }

    const target = supportedPublishBatchTargets.find(
      (target) => target === PUBLISH_BATCH_TARGET?.toLocaleLowerCase()
    )
    if (target === undefined) {
      throw Error(
        `A valid PUBLISH_BATCH_TARGET is required. Please specify one of the following: ${supportedPublishBatchTargets}`
      )
    }
    return target
  })(),
  EXECUTOR_URI: EXECUTOR_URI || 'http://127.0.0.1:5000',
  BRIDGE_ID: BRIDGE_ID ? parseInt(BRIDGE_ID) : 1,
  OUTPUT_SUBMITTER_MNEMONIC: OUTPUT_SUBMITTER_MNEMONIC
    ? OUTPUT_SUBMITTER_MNEMONIC.replace(/'/g, '')
    : '',
  EXECUTOR_MNEMONIC: EXECUTOR_MNEMONIC
    ? EXECUTOR_MNEMONIC.replace(/'/g, '')
    : '',
  BATCH_SUBMITTER_MNEMONIC: BATCH_SUBMITTER_MNEMONIC
    ? BATCH_SUBMITTER_MNEMONIC.replace(/'/g, '')
    : '',
  CHALLENGER_MNEMONIC: CHALLENGER_MNEMONIC
    ? CHALLENGER_MNEMONIC.replace(/'/g, '')
    : '',
  USE_LOG_FILE: USE_LOG_FILE ? JSON.parse(USE_LOG_FILE) : false,
  L1_CHAIN_ID: L1_CHAIN_ID ? L1_CHAIN_ID : '',
  L2_CHAIN_ID: L2_CHAIN_ID ? L2_CHAIN_ID : '',
  L1_CLIENT_ID: L1_CLIENT_ID ? L1_CLIENT_ID : '',
  l1lcd: new LCDClientL1(
    L1_LCD_URI ? L1_LCD_URI.split(',')[0] : 'http://127.0.0.1:1317',
    {
      gasPrices: '0.15uinit',
      gasAdjustment: '2',
      chainId: L1_CHAIN_ID
    }
  ),
  l2lcd: new LCDClientL2(
    L2_LCD_URI ? L2_LCD_URI.split(',')[0] : 'http://127.0.0.1:1317',
    {
      gasPrices: L2_GAS_PRICES || '0umin',
      gasAdjustment: '2',
      chainId: L2_CHAIN_ID
    }
  ),
  batchlcd: (() => {
    return new LCDClientL1(
      !PUBLISH_BATCH_TARGET || PUBLISH_BATCH_TARGET == 'l1'
        ? L1_LCD_URI
          ? L1_LCD_URI.split(',')[0]
          : 'http://127.0.0.1:1317'
        : BATCH_LCD_URI
          ? BATCH_LCD_URI.split(',')[0]
          : 'http://127.0.0.1:1317',
      {
        gasPrices: BATCH_GAS_PRICES || `0.2${BATCH_DENOM ?? 'uinit'}`,
        gasAdjustment: '2',
        chainId: BATCH_CHAIN_ID ? BATCH_CHAIN_ID : L1_CHAIN_ID
      }
    )
  })(),
  SLACK_WEB_HOOK: SLACK_WEB_HOOK ? SLACK_WEB_HOOK : '',
  SUBMISSION_INTERVAL: SUBMISSION_INTERVAL
    ? parseInt(SUBMISSION_INTERVAL)
    : 3600,
  SUBMISSION_THRESHOLD: SUBMISSION_THRESHOLD
    ? parseFloat(SUBMISSION_THRESHOLD)
    : 0.66,
  FINALIZATION_PERIOD: FINALIZATION_PERIOD
    ? parseInt(FINALIZATION_PERIOD)
    : 3600,
  IBC_METADATA: IBC_METADATA ? IBC_METADATA : '',
  DELETE_OUTPUT_PROPOSAL: DELETE_OUTPUT_PROPOSAL
    ? DELETE_OUTPUT_PROPOSAL
    : 'false',
  SLACK_NOT_ENOUGH_BALANCE_THRESHOLD: SLACK_NOT_ENOUGH_BALANCE_THRESHOLD
    ? parseInt(SLACK_NOT_ENOUGH_BALANCE_THRESHOLD)
    : 10_000_000,
  EXECUTOR_L1_MONITOR_HEIGHT: EXECUTOR_L1_MONITOR_HEIGHT
    ? parseInt(EXECUTOR_L1_MONITOR_HEIGHT)
    : 0,
  EXECUTOR_L2_MONITOR_HEIGHT: EXECUTOR_L2_MONITOR_HEIGHT
    ? parseInt(EXECUTOR_L2_MONITOR_HEIGHT)
    : 0,
  BATCH_SUBMITTER_ADDR: BATCH_SUBMITTER_ADDR || '',
  ENABLE_API_ONLY: ENABLE_API_ONLY ? ENABLE_API_ONLY == 'true' : false,
  ENABLE_ORACLE: ENABLE_ORACLE ? ENABLE_ORACLE == 'true' : false,

  // prometheus
  PROMETHEUS_METRICS_MODE: PROMETHEUS_METRICS_MODE
    ? PROMETHEUS_METRICS_MODE
    : 'pull',
  PROMETHEUS_GATEWAY_URI: PROMETHEUS_GATEWAY_URI
    ? PROMETHEUS_GATEWAY_URI
    : 'http://127.0.0.1:9091',
  PROMETHEUS_TIME_OUT: PROMETHEUS_TIME_OUT
    ? parseInt(PROMETHEUS_TIME_OUT)
    : 5000
}

// check celestia config
validateCelestiaConfig()

export const INTERVAL_BATCH = 100_000
export const INTERVAL_MONITOR = 100
export const INTERVAL_OUTPUT = 10_000
