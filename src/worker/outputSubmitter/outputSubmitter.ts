import { Msg, MsgProposeOutput } from 'initia-l1'
import { INTERVAL_OUTPUT } from '../../config'
import { ExecutorOutputEntity } from '../../orm'
import { delay } from 'bluebird'
import { outputLogger as logger } from '../../lib/logger'
import { ErrorTypes } from '../../lib/error'
import { config } from '../../config'
import { getLastOutputInfo } from '../../lib/query'
import MonitorHelper from '../bridgeExecutor/monitor/helper'
import { DataSource, EntityManager } from 'typeorm'
import { getDB } from './db'
import {
  TxWalletL1,
  WalletType,
  getWallet,
  initWallet
} from '../../lib/walletL1'
import { updateOutputUsageMetrics } from '../../lib/metrics'

const MAX_OUTPUT_PROPOSAL = 50

export class OutputSubmitter {
  private db: DataSource
  private submitter: TxWalletL1
  private syncedOutputIndex = 1
  private processedBlockNumber = 1
  private isRunning = false
  private bridgeId: number
  helper: MonitorHelper = new MonitorHelper()

  async init() {
    [this.db] = getDB()
    initWallet(WalletType.OutputSubmitter, config.l1lcd)
    this.submitter = getWallet(WalletType.OutputSubmitter)
    this.bridgeId = config.BRIDGE_ID
    this.isRunning = true
  }

  public async run() {
    await this.init()

    while (this.isRunning) {
      await this.processOutput()
      await delay(INTERVAL_OUTPUT)
      updateOutputUsageMetrics()
    }
  }

  async getOutputs(
    manager: EntityManager
  ): Promise<ExecutorOutputEntity[]> {
    try {
      const lastOutputInfo = await getLastOutputInfo(this.bridgeId)
      if (lastOutputInfo) {
        this.syncedOutputIndex = lastOutputInfo.output_index + 1
      }

      const outputs = await this.helper.getAllOutput(
        manager,
        ExecutorOutputEntity,
      )

      return outputs.filter(output => output.outputIndex >= this.syncedOutputIndex)
    } catch (err) {
      if (err.response?.data.type === ErrorTypes.NOT_FOUND_ERROR) {
        logger.warn(
          `waiting for output index from L1: ${this.syncedOutputIndex}, processed block number: ${this.processedBlockNumber}`
        )
        await delay(INTERVAL_OUTPUT)
        return []
      }
      throw err
    }
  }

  async processOutput() {
    await this.db.transaction(async (manager: EntityManager) => {
      const outputs = await this.getOutputs(manager)
      if (outputs.length === 0) {
        logger.info(
          `waiting for output index from DB: ${this.syncedOutputIndex}, processed block number: ${this.processedBlockNumber}`
        )
        return
      }

      const chunkedOutputs: ExecutorOutputEntity[] = []
      
      for (let i = 0; i < outputs.length; i += MAX_OUTPUT_PROPOSAL) {
        chunkedOutputs.push(...outputs.slice(i, i + MAX_OUTPUT_PROPOSAL))
        await this.proposeOutputs(chunkedOutputs)
        chunkedOutputs.length = 0
      }
    })
  }

  public async stop() {
    this.isRunning = false
  }

  private async proposeOutputs(outputEntities: ExecutorOutputEntity[]) {
    const msgs: Msg[] = []
    
    for (const output of outputEntities) {
      msgs.push(
        new MsgProposeOutput(
          this.submitter.key.accAddress,
          this.bridgeId,
          output.endBlockNumber,
          output.outputRoot
        )
      )
    }

    await this.submitter.transaction(msgs, undefined, 1000 * 60 * 10) // 10 minutes
    logger.info(`succeed to propose ${outputEntities.length} outputs from ${outputEntities[0].outputIndex} to ${outputEntities[outputEntities.length - 1].outputIndex}`)
  }
}
