import { getDB } from '../db'
import UnconfirmedTxEntity from '../../../orm/executor/UnconfirmedTxEntity'
import { Coin, MsgFinalizeTokenDeposit } from 'initia-l2'
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

  async resubmitFailedDepositTx(
    unconfirmedTx: UnconfirmedTxEntity
  ): Promise<void> {
    const txKey = `${unconfirmedTx.sender}-${unconfirmedTx.receiver}-${unconfirmedTx.amount}`
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
    try {
      await this.executorL2.transaction([msg])
      await this.updateProcessed(unconfirmedTx)
      await notifySlack(
        txKey,
        buildResolveErrorNotification(
          `[INFO] Transaction successfully resubmitted and processed for ${unconfirmedTx.sender} to ${unconfirmedTx.receiver} of amount ${unconfirmedTx.amount}.`
        ),
        false
      )
    } catch (err) {
      if (this.errorCounter++ < 30) {
        await Bluebird.delay(SECOND)
        return
      }
      this.errorCounter = 0
      await notifySlack(txKey, buildFailedTxNotification(unconfirmedTx))
      this.logger.error(
        `[resubmitFailedDepositTx - ${this.name()}] Failed to resubmit tx: bridge id ${unconfirmedTx.bridgeId} sequence ${unconfirmedTx.sequence}`,
        err
      )
    }
  }

  async getunconfirmedTxs(): Promise<UnconfirmedTxEntity[]> {
    return await this.db.getRepository(UnconfirmedTxEntity).find({
      where: {
        processed: false
      }
    })
  }

  public async ressurect(): Promise<void> {
    const unconfirmedTxs = await this.getunconfirmedTxs()

    if (unconfirmedTxs.length === 0) {
      this.logger.info(`[ressurect - ${this.name()}] No unconfirmed txs found`)
      return
    }

    this.logger.info(
      `[ressurect - ${this.name()}] Found ${unconfirmedTxs.length} unconfirmed txs`
    )
    for (const unconfirmedTx of unconfirmedTxs) {
      const error = unconfirmedTx.error
      // Check x/opchild/errors.go
      if (error.includes('deposit already finalized')) {
        await this.updateProcessed(unconfirmedTx)
        continue
      }
      await this.resubmitFailedDepositTx(unconfirmedTx)
    }
  }
}
