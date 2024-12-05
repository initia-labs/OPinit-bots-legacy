import { getDB } from '../db'
import UnconfirmedTxEntity from '../../../orm/executor/UnconfirmedTxEntity'
import { Coin, Msg, MsgFinalizeTokenDeposit } from 'initia-l2'
import { config } from '../../../config'
import { DataSource } from 'typeorm'
import winston from 'winston'
import { TxWalletL2, WalletType, initWallet } from '../../../lib/walletL2'
import { buildResolveErrorNotification, notifySlack } from '../../../lib/slack'
import MonitorHelper from './helper'

const MAX_RESURRECT_SIZE = 100

export class Resurrector {
  private db: DataSource
  unconfirmedTxs: UnconfirmedTxEntity[] = []
  processedTxsNum: number
  isRunning = true
  helper: MonitorHelper = new MonitorHelper()

  constructor(
    public logger: winston.Logger,
    public executorL2: TxWalletL2
  ) {
    [this.db] = getDB()
    initWallet(WalletType.Executor, config.l2lcd)
  }

  public name(): string {
    return 'resurrector'
  }

  async updateProcessed(unconfirmedTx: UnconfirmedTxEntity): Promise<void> {
    await this.db.getRepository(UnconfirmedTxEntity).update(
      {
        bridgeId: unconfirmedTx.bridgeId,
        sequence: unconfirmedTx.sequence,
        processed: false
      },
      { processed: true }
    )

    this.processedTxsNum++
    this.logger.info(
      `[updateProcessed - ${this.name()}] Resurrected failed tx sequence ${unconfirmedTx.sequence} current processed txs: ${this.processedTxsNum} / ${this.unconfirmedTxs.length}`
    )
  }

  createMsg(unconfirmedTx: UnconfirmedTxEntity): Msg {
    const msg = new MsgFinalizeTokenDeposit(
      this.executorL2.key.accAddress,
      unconfirmedTx.sender,
      unconfirmedTx.receiver,
      new Coin(unconfirmedTx.l2Denom, unconfirmedTx.amount),
      parseInt(unconfirmedTx.sequence),
      unconfirmedTx.l1Height,
      unconfirmedTx.l1Denom,
      Buffer.from(unconfirmedTx.data, 'hex').toString('base64')
    )
    return msg
  }

  createTxKey(unconfirmedTxs: UnconfirmedTxEntity[]): string {
    return `${unconfirmedTxs[0].sender}-${unconfirmedTxs[0].receiver}-${unconfirmedTxs[0].amount}`
  }

  async resubmitFailedDepositTxs(
    unconfirmedTxs: UnconfirmedTxEntity[]
  ): Promise<void> {
    const msgs = unconfirmedTxs.map((unconfirmedTx) =>
      this.createMsg(unconfirmedTx)
    )
    const txKey = this.createTxKey(unconfirmedTxs)
    try {
      await this.executorL2.transaction(msgs)
      await Promise.all(unconfirmedTxs.map((tx) => this.updateProcessed(tx)))
      await notifySlack(
        txKey,
        buildResolveErrorNotification(
          `[INFO] Transaction successfully resubmitted and processed from ${unconfirmedTxs[0].sequence} to ${unconfirmedTxs[unconfirmedTxs.length - 1].sequence} sequence.`
        ),
        false
      )
    } catch (err) {
      await this.resubmitFailedDepositTxSplit(unconfirmedTxs)
    }
  }

  async resubmitFailedDepositTxSplit(
    unconfirmedTxs: UnconfirmedTxEntity[]
  ): Promise<void> {
    for (const unconfirmedTx of unconfirmedTxs) {
      try {
        const msg = this.createMsg(unconfirmedTx)
        await this.executorL2.transaction([msg])
        await this.updateProcessed(unconfirmedTx)
      } catch (err) {
        const errMsg = this.helper.extractErrorMessage(err)
        await this.handleErrors(unconfirmedTx, errMsg)
      }
    }
  }

  async handleErrors(
    unconfirmedTx: UnconfirmedTxEntity,
    errMsg: string
  ): Promise<void> {
    // Check x/opchild/errors.go
    if (
      errMsg.includes('deposit already finalized') ||
      errMsg.includes('not allowed to receive funds')
    ) {
      await this.updateProcessed(unconfirmedTx)
    } else {
      this.logger.error(
        `[handleErrors - ${this.name()}] Failed to resubmit tx: sequence ${unconfirmedTx.sequence}, ${errMsg}`
      )
      throw new Error(
        `failed to resubmit ${unconfirmedTx.sequence}: ${errMsg}`
      )
    }
  }

  async getUnconfirmedTxs(): Promise<UnconfirmedTxEntity[]> {
    return await this.db.getRepository(UnconfirmedTxEntity).find({
      where: {
        processed: false
      }
    })
  }

  public async resurrect(): Promise<void> {
    this.unconfirmedTxs = await this.getUnconfirmedTxs()
    this.processedTxsNum = 0

    if (this.unconfirmedTxs.length === 0) {
      this.logger.info(`[resurrect - ${this.name()}] No unconfirmed txs found`)
      return
    }

    this.logger.info(
      `[resurrect - ${this.name()}] Found ${this.unconfirmedTxs.length} unconfirmed txs`
    )

    const unconfirmedTxsChunks: UnconfirmedTxEntity[] = []

    for (const unconfirmedTx of this.unconfirmedTxs) {
      unconfirmedTxsChunks.push(unconfirmedTx)
      if (unconfirmedTxsChunks.length === MAX_RESURRECT_SIZE) {
        await this.resubmitFailedDepositTxs(unconfirmedTxsChunks)
        unconfirmedTxsChunks.length = 0
      }
    }

    if (unconfirmedTxsChunks.length > 0) {
      await this.resubmitFailedDepositTxs(unconfirmedTxsChunks)
    }
  }
}
