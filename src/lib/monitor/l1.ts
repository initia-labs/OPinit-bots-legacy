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
  ExecutorOutputEntity
} from '../../orm'
import { EntityManager } from 'typeorm'
import { RPCClient, RPCSocket } from '../rpc'
import { getDB } from '../../worker/bridgeExecutor/db'
import winston from 'winston'
import { config } from '../../config'
import { TxWalletL2, WalletType, getWallet, initWallet } from '../walletL2'

export class L1Monitor extends Monitor {
  executorL2: TxWalletL2

  constructor(
    public socket: RPCSocket,
    public rpcClient: RPCClient,
    logger: winston.Logger
  ) {
    super(socket, rpcClient, logger);
    [this.db] = getDB()
    initWallet(WalletType.Executor, config.l2lcd)
    this.executorL2 = getWallet(WalletType.Executor)
  }

  public name(): string {
    return 'executor_l1_monitor'
  }

  private async setBridgeInfo(bridgeInfoL1: BridgeInfo): Promise<void> {
    const l2Msgs = [
      new MsgSetBridgeInfo(
        this.executorL2.key.accAddress,
        new BridgeInfo(
          bridgeInfoL1.bridge_id,
          bridgeInfoL1.bridge_addr,
          config.L1_CHAIN_ID,
          config.L1_CLIENT_ID,
          bridgeInfoL1.bridge_config
        )
      )
    ]
    await this.executorL2.transaction(l2Msgs)
  }

  public async prepareMonitor(): Promise<void> {
    const bridgeInfoL1 = await config.l1lcd.ophost.bridgeInfo(config.BRIDGE_ID)

    try {
      const bridgeInfoL2 = await this.executorL2.lcd.opchild.bridgeInfo()
      if (
        config.ENABLE_ORACLE &&
        config.L1_CLIENT_ID &&
        bridgeInfoL2.l1_client_id == ''
      ) {
        await this.setBridgeInfo(bridgeInfoL1)
      }
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      if (errMsg.includes('bridge info not found')) {
        // not found bridge info in l2, set bridge info
        await this.setBridgeInfo(bridgeInfoL1)
      }
    }
  }

  public async handleNewBlock(): Promise<void> {
    if (!config.ENABLE_ORACLE) return

    const latestHeight = this.socket.latestHeight
    const latestTx0 = this.socket.latestTx0

    if (!latestHeight || !latestTx0) return

    const msgs = [
      new MsgUpdateOracle(
        this.executorL2.key.accAddress,
        latestHeight,
        latestTx0
      )
    ]

    try {
      await this.executorL2.transaction(msgs)
      this.logger.info(
        `
          Succeeded to update oracle tx in height: ${this.currentHeight} ${latestHeight} ${latestTx0}
        `
      )
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      this.logger.warn(
        `
          Failed to submit tx in height: ${this.currentHeight}
          Msg: ${latestHeight} ${latestTx0}
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
    const [isEmpty, events] = await this.helper.fetchAllEvents(
      config.l1lcd,
      this.currentHeight
    )

    if (isEmpty) return false

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
        `
          Succeeded to submit tx in height: ${this.currentHeight} 
          ${stringfyMsgs}
        `
      )
    } catch (err) {
      const errMsg = this.helper.extractErrorMessage(err)
      this.logger.warn(
        `
          Failed to submit tx in height: ${this.currentHeight}
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
