import { getDB } from '../db'
import UnconfirmedTxEntity from '../../../orm/executor/UnconfirmedTxEntity'
import { Coin, Msg, MsgFinalizeTokenDeposit } from 'initia-l2'
import { SECOND, config } from '../../../config'
import { DataSource } from 'typeorm'
import Bluebird from 'bluebird'
import winston from 'winston'
import { TxWalletL2, WalletType, initWallet } from '../../../lib/walletL2'
import {
  buildFailedTxNotification,
  buildResolveErrorNotification,
  notifySlack
} from '../../../lib/slack'

const MAX_RESURRECT_SIZE = 100

export class Resurrector {
  private db: DataSource
  isRunning = true
  errorCounter = 0

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

    this.logger.info(
      `[updateProcessed - ${this.name()}] Resurrected failed tx sequence ${unconfirmedTx.sequence}`
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
      if (this.errorCounter++ < 30) {
        await Bluebird.delay(SECOND)
        return
      }
      this.errorCounter = 0
      await notifySlack(txKey, buildFailedTxNotification(unconfirmedTxs[0]))
      this.logger.error(
        `[resubmitFailedDepositTxs - ${this.name()}] Failed to resubmit txs: bridge id ${unconfirmedTxs[0].bridgeId} sequence ${unconfirmedTxs[0].sequence}`,
        err
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
    const unconfirmedTxs = await this.getUnconfirmedTxs()

    if (unconfirmedTxs.length === 0) {
      this.logger.info(`[resurrect - ${this.name()}] No unconfirmed txs found`)
      return
    }

    this.logger.info(
      `[resurrect - ${this.name()}] Found ${unconfirmedTxs.length} unconfirmed txs`
    )

    const unconfirmedTxsChunks: UnconfirmedTxEntity[] = []
    for (const unconfirmedTx of unconfirmedTxs) {
      // Check x/opchild/errors.go
      if (unconfirmedTx.error.includes('deposit already finalized')) {
        await this.updateProcessed(unconfirmedTx)
        continue
      }
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
