import { ExecutorOutputEntity, ExecutorWithdrawalTxEntity } from '../../../orm'
import { Monitor } from './monitor'
import { EntityManager } from 'typeorm'
import { BlockInfo, OutputInfo } from 'initia-l2'
import { getDB } from '../db'
import { RPCClient } from '../../../lib/rpc'
import winston from 'winston'
import { config } from '../../../config'
import { getBridgeInfo, getLastOutputInfo } from '../../../lib/query'
import {
  TxWalletL2,
  WalletType,
  getWallet,
  initWallet
} from '../../../lib/walletL2'
import { BOT_NAME } from '../../common/name'

export class L2Monitor extends Monitor {
  executorL2: TxWalletL2

  constructor(
    public rpcClient: RPCClient,
    logger: winston.Logger
  ) {
    super(rpcClient, logger);
    [this.db] = getDB()
    initWallet(WalletType.Executor, config.l2lcd)
    this.executorL2 = getWallet(WalletType.Executor)
  }

  async getLatestBlock(): Promise<BlockInfo> {
    return await this.executorL2.lcd.tendermint.blockInfo()
  }

  public name(): string {
    return BOT_NAME.EXECUTOR_L2_MONITOR
  }

  dateToSeconds(date: Date): number {
    return Math.floor(date.getTime() / 1000)
  }

  private getCurTimeSec(): number {
    return this.dateToSeconds(new Date())
  }

  private async handleInitiateTokenWithdrawalEvent(
    manager: EntityManager,
    data: { [key: string]: string }
  ): Promise<void> {
    const outputInfo = await this.helper.getLastOutputFromDB(
      manager,
      ExecutorOutputEntity
    )

    if (!outputInfo) {
      this.logger.info(
        `[handleInitiateTokenWithdrawalEvent - ${this.name()}] No output info`
      )
      return
    }

    const pair = await config.l1lcd.ophost
      .tokenPairByL2Denom(this.bridgeId, data['denom'])
      .catch((e) => {
        const errMsg = this.helper.extractErrorMessage(e)
        this.logger.warn(`Failed to get token ${data['denom']} pair ${errMsg}`)
        return null
      })

    if (!pair) {
      this.logger.info(
        `[handleInitiateTokenWithdrawalEvent - ${this.name()}] No token pair`
      )
      return
    }

    const tx: ExecutorWithdrawalTxEntity = {
      l1Denom: pair.l1_denom,
      l2Denom: pair.l2_denom,
      sequence: data['l2_sequence'],
      sender: data['from'],
      receiver: data['to'],
      amount: data['amount'],
      bridgeId: this.bridgeId.toString(),
      outputIndex: outputInfo ? outputInfo.outputIndex + 1 : 1,
      merkleRoot: '',
      merkleProof: []
    }

    await this.helper.saveEntity(manager, ExecutorWithdrawalTxEntity, tx)
    this.logger.info(
      `[handleInitiateTokenWithdrawalEvent - ${this.name()}] Succeeded to save withdrawal tx`
    )
  }

  public async handleEvents(manager: EntityManager): Promise<boolean> {
    const blockResults = await this.getBlockResultsByHeight(this.currentHeight)
    const [isEmpty, events] = await this.helper.fetchAllEvents(blockResults)
    if (isEmpty) {
      this.logger.info(
        `[handleEvents - ${this.name()}] No events in height: ${this.currentHeight}`
      )
      return false
    }

    const withdrawalEvents = events.filter(
      (evt) => evt.type === 'initiate_token_withdrawal'
    )
    for (const evt of withdrawalEvents) {
      const attrMap = this.helper.eventsToAttrMap(evt)
      await this.handleInitiateTokenWithdrawalEvent(manager, attrMap)
    }

    return true
  }

  async checkSubmissionInterval(
    lastOutputSubmitted: OutputInfo | null,
    lastOutputFromDB: ExecutorOutputEntity | null
  ): Promise<boolean> {
    // if no output from DB, create output (first output)
    if (!lastOutputFromDB) {
      this.logger.info(
        `[checkSubmissionInterval - ${this.name()}] No output from DB`
      )
      return true
    }

    // if no output submitted, wait for submission
    if (!lastOutputSubmitted) return false

    // if output index from db is greater, wait for submission
    if (lastOutputSubmitted.output_index < lastOutputFromDB.outputIndex) {
      this.logger.info(
        `[checkSubmissionInterval - ${this.name()}] Output index not matched`
      )
      return false
    }

    const lastOutputSubmittedTime =
      lastOutputSubmitted.output_proposal.l1_block_time
    const bridgeInfo = await getBridgeInfo(this.bridgeId)
    const submissionInterval =
      bridgeInfo.bridge_config.submission_interval.seconds.toNumber()
    const targetTimeSec =
      this.dateToSeconds(lastOutputSubmittedTime) +
      Math.floor(submissionInterval * config.SUBMISSION_THRESHOLD)

    // if submission interval not reached, wait for submission
    if (this.getCurTimeSec() < targetTimeSec) {
      if (this.currentHeight % 10 === 0) {
        this.logger.info(
          `[checkSubmissionInterval - ${this.name()}] need to wait for submission interval ${targetTimeSec - this.getCurTimeSec()} seconds`
        )
      }

      return false
    }

    // if submission interval reached, create output
    this.logger.info(
      `[checkSubmissionInterval - ${this.name()}] Submission interval reached! try to create output...`
    )
    return true
  }

  async handleOutput(manager: EntityManager): Promise<void> {
    const lastOutputSubmitted = await getLastOutputInfo(this.bridgeId)
    const lastOutputFromDB = await this.helper.getLastOutputFromDB(
      manager,
      ExecutorOutputEntity
    )

    if (
      !(await this.checkSubmissionInterval(
        lastOutputSubmitted,
        lastOutputFromDB
      ))
    )
      return

    const lastOutputEndBlockNumber = lastOutputSubmitted
      ? lastOutputSubmitted.output_proposal.l2_block_number
      : 0
    const lastOutputIndex = lastOutputSubmitted
      ? lastOutputSubmitted.output_index
      : 0

    const startBlockNumber = lastOutputEndBlockNumber + 1
    const endBlockNumber = this.currentHeight
    const outputIndex = lastOutputIndex + 1

    if (startBlockNumber > endBlockNumber) {
      this.logger.info(
        `[handleOutput - ${this.name()}] No new block to process ${startBlockNumber - endBlockNumber} block remaining...`
      )
      return
    }

    const blockInfo: BlockInfo = await config.l2lcd.tendermint.blockInfo(
      this.currentHeight
    )

    // fetch txs and build merkle tree for withdrawal storage
    const txEntities = await this.helper.getWithdrawalTxs(
      manager,
      ExecutorWithdrawalTxEntity,
      outputIndex
    )

    const merkleRoot = await this.helper.saveMerkleRootAndProof(
      manager,
      ExecutorWithdrawalTxEntity,
      txEntities
    )

    const outputEntity = this.helper.calculateOutputEntity(
      outputIndex,
      blockInfo,
      merkleRoot,
      startBlockNumber,
      endBlockNumber
    )

    this.logger.info(
      `output entity created: block height (${startBlockNumber} - ${endBlockNumber})`
    )
    await this.helper.saveEntity(manager, ExecutorOutputEntity, outputEntity)
  }

  public async handleBlock(manager: EntityManager): Promise<void> {
    await this.handleOutput(manager)
  }
}
