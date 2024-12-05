import { Monitor } from './monitor'
import {
  BridgeInfo,
  Coin,
  Msg,
  MsgFinalizeTokenDeposit,
  MsgSetBridgeInfo,
  MsgUpdateOracle
} from 'initia-l2'
import {
  ExecutorDepositTxEntity,
  ExecutorUnconfirmedTxEntity,
  ExecutorOutputEntity,
  StateEntity
} from '../../../orm'
import { EntityManager } from 'typeorm'
import { RPCClient } from '../../../lib/rpc'
import { getDB } from '../db'
import winston from 'winston'
import { config } from '../../../config'
import {
  TxWalletL2,
  WalletType,
  getWallet,
  initWallet
} from '../../../lib/walletL2'
import { Resurrector } from './resurrector'
import { BOT_NAME } from '../../common/name'

export class L1Monitor extends Monitor {
  executorL2: TxWalletL2
  oracleHeight: number
  resurrector: Resurrector

  constructor(
    public rpcClient: RPCClient,
    logger: winston.Logger
  ) {
    super(rpcClient, logger);
    [this.db] = getDB()
    initWallet(WalletType.Executor, config.l2lcd)
    this.executorL2 = getWallet(WalletType.Executor)
    this.resurrector = new Resurrector(logger, this.executorL2)
    this.oracleHeight = 0
  }

  public name(): string {
    return BOT_NAME.EXECUTOR_L1_MONITOR
  }

  private async setBridgeInfo(
    bridgeInfoL1: BridgeInfo,
    l1ClientId: string
  ): Promise<void> {
    this.logger.info(
      `[setBridgeInfo - ${this.name()}] bridge_id: ${bridgeInfoL1.bridge_id} l1_client_id: ${l1ClientId}`
    )

    if (config.L1_CHAIN_ID == '') throw new Error('L1_CHAIN_ID is not set')
    const l2Msgs = [
      new MsgSetBridgeInfo(
        this.executorL2.key.accAddress,
        new BridgeInfo(
          bridgeInfoL1.bridge_id,
          bridgeInfoL1.bridge_addr,
          config.L1_CHAIN_ID,
          l1ClientId,
          bridgeInfoL1.bridge_config
        )
      )
    ]
    const res = await this.executorL2.transaction(l2Msgs)
    this.logger.info(
      `[setBridgeInfo - ${this.name()}] Successfully submitted setBridgeInfo : ${res.txhash}`
    )
  }

  public async prepareMonitor(): Promise<void> {
    const state = await this.db.getRepository(StateEntity).findOne({
      where: {
        name: 'oracle_height'
      }
    })
    this.oracleHeight = state?.height || 0
    const bridgeInfoL1 = await config.l1lcd.ophost.bridgeInfo(config.BRIDGE_ID)

    try {
      const bridgeInfoL2 = await this.executorL2.lcd.opchild.bridgeInfo()
      if (
        config.ENABLE_ORACLE &&
        config.L1_CLIENT_ID &&
        !bridgeInfoL2.l1_client_id
      ) {
        await this.setBridgeInfo(bridgeInfoL1, config.L1_CLIENT_ID)
      }
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      this.logger.error(`[prepareMonitor - ${this.name()}] Error: ${errMsg}`)
      if (errMsg.includes('bridge info not found')) {
        // not found bridge info in l2, set bridge info
        this.logger.info(
          `[prepareMonitor - ${this.name()}] setBridgeInfo with empty l1ClientId`
        )
        return await this.setBridgeInfo(bridgeInfoL1, '')
      }
      throw err
    }
  }

  public async handleNewBlock(): Promise<void> {
    // ressurect every unconfirmed tx before handling new block
    await this.resurrector.resurrect()

    if (!config.ENABLE_ORACLE) return
    if (!this.latestHeight || this.oracleHeight == this.latestHeight) {
      this.logger.info(
        `[handleNewBlock - ${this.name()}] No new block to update oracle tx`
      )
      return
    }

    const latestTx0 = (await this.getBlockByHeight(this.latestHeight))?.block
      .data.txs[0]

    if (!latestTx0) {
      this.logger.info(
        `[handleNewBlock - ${this.name()}] No txs in L1 height: ${this.latestHeight}`
      )
      return
    }

    const msgs = [
      new MsgUpdateOracle(
        this.executorL2.key.accAddress,
        this.latestHeight,
        latestTx0
      )
    ]

    try {
      const res = await this.executorL2.transaction(msgs)
      this.logger.info(
        `
          [handleNewBlock - ${this.name()}] Succeeded to update oracle tx in height
          currentHeight: ${this.currentHeight} 
          latestHeight: ${this.latestHeight}
          txhash: ${res.txhash}
        `
      )

      this.oracleHeight = this.latestHeight
      await this.db
        .getRepository(StateEntity)
        .save({ name: 'oracle_height', height: this.oracleHeight })
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      this.logger.error(
        `
          [handleNewBlock - ${this.name()}] Failed to submit tx
          currentHeight: ${this.currentHeight}
          latestHeight: ${this.latestHeight}
          Error: ${errMsg}
        `
      )
    }
  }

  public async handleInitiateTokenDeposit(
    manager: EntityManager,
    data: { [key: string]: string }
  ): Promise<[ExecutorDepositTxEntity, MsgFinalizeTokenDeposit]> {
    const lastIndex = await this.helper.getLastOutputIndex(
      manager,
      ExecutorOutputEntity
    )

    const entity: ExecutorDepositTxEntity = {
      sequence: data['l1_sequence'],
      sender: data['from'],
      receiver: data['to'],
      l1Denom: data['l1_denom'],
      l2Denom: data['l2_denom'],
      amount: data['amount'],
      data: data['data'],
      outputIndex: lastIndex + 1,
      bridgeId: this.bridgeId.toString(),
      l1Height: this.currentHeight
    }

    return [
      entity,
      new MsgFinalizeTokenDeposit(
        this.executorL2.key.accAddress,
        data['from'],
        data['to'],
        new Coin(data['l2_denom'], data['amount']),
        parseInt(data['l1_sequence']),
        this.currentHeight,
        data['l1_denom'],
        Buffer.from(data['data'], 'hex').toString('base64')
      )
    ]
  }

  public async handleEvents(manager: EntityManager): Promise<any> {
    const blockResults = await this.getBlockResultsByHeight(this.currentHeight)
    const [isEmpty, events] = await this.helper.fetchAllEvents(blockResults)
    if (isEmpty) {
      this.logger.info(
        `[handleEvents - ${this.name()}] No events in height: ${this.currentHeight}`
      )
      return false
    }

    const l2Msgs: Msg[] = []
    const depositEntities: ExecutorDepositTxEntity[] = []

    const depositEvents = events.filter(
      (evt) => evt.type === 'initiate_token_deposit'
    )
    for (const evt of depositEvents) {
      const attrMap = this.helper.eventsToAttrMap(evt)
      if (attrMap['bridge_id'] !== this.bridgeId.toString()) continue
      const [entity, l2Msg] = await this.handleInitiateTokenDeposit(
        manager,
        attrMap
      )

      depositEntities.push(entity)
      if (l2Msg) l2Msgs.push(l2Msg)
    }

    await this.processMsgs(manager, l2Msgs, depositEntities)
    return true
  }

  async processMsgs(
    manager: EntityManager,
    msgs: Msg[],
    depositEntities: ExecutorDepositTxEntity[]
  ): Promise<void> {
    if (msgs.length == 0) return
    const stringfyMsgs = msgs.map((msg) => msg.toJSON().toString())
    try {
      for (const entity of depositEntities) {
        await this.helper.saveEntity(manager, ExecutorDepositTxEntity, entity)
      }

      await this.executorL2.transaction(msgs)
      this.logger.info(
        `[processMsgs - ${this.name()}] Succeeded to submit tx in height: ${this.currentHeight} Msgs length: ${msgs.length}`
      )
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      this.logger.error(
        `
          [processMsgs - ${this.name()}] Failed to submit tx in height: ${this.currentHeight}
          Msg: ${stringfyMsgs}
          Error: ${errMsg}
        `
      )
      for (const entity of depositEntities) {
        await this.helper.saveEntity(manager, ExecutorUnconfirmedTxEntity, {
          ...entity,
          error: errMsg,
          processed: false
        })
      }
    }
  }
}
