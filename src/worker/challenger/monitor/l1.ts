import { Monitor } from '../../bridgeExecutor/monitor'
import {
  ChallengerDepositTxEntity,
  ChallengerFinalizeWithdrawalTxEntity
} from '../../../orm'
import { EntityManager } from 'typeorm'
import { RPCClient } from '../../../lib/rpc'
import { getDB } from '../db'
import winston from 'winston'
import { BOT_NAME } from '../../common/name'

export class L1Monitor extends Monitor {
  constructor(
    public rpcClient: RPCClient,
    logger: winston.Logger
  ) {
    super(rpcClient, logger);
    [this.db] = getDB()
  }

  public name(): string {
    return BOT_NAME.CHALLENGER_L1_MONITOR
  }

  public async handleInitiateTokenDeposit(
    manager: EntityManager,
    data: { [key: string]: string }
  ): Promise<void> {
    const entity: ChallengerDepositTxEntity = {
      sequence: data['l1_sequence'],
      sender: data['from'],
      receiver: data['to'],
      l1Denom: data['l1_denom'],
      l2Denom: data['l2_denom'],
      amount: data['amount'],
      data: data['data']
    }
    await manager.getRepository(ChallengerDepositTxEntity).save(entity)
  }

  public async handleFinalizeTokenWithdrawalEvent(
    manager: EntityManager,
    data: { [key: string]: string }
  ): Promise<void> {
    const entity: ChallengerFinalizeWithdrawalTxEntity = {
      bridgeId: data['bridge_id'],
      outputIndex: parseInt(data['output_index']),
      sequence: data['l2_sequence'],
      sender: data['from'],
      receiver: data['to'],
      l1Denom: data['l1_denom'],
      l2Denom: data['l2_denom'],
      amount: data['amount']
    }

    await manager
      .getRepository(ChallengerFinalizeWithdrawalTxEntity)
      .save(entity)
  }

  public async handleEvents(manager: EntityManager): Promise<boolean> {
    const blockResults = await this.getBlockResultsByHeight(this.currentHeight)
    const [isEmpty, events] = await this.helper.fetchAllEvents(blockResults)

    if (isEmpty) return false

    const depositEvents = events.filter(
      (evt) => evt.type === 'initiate_token_deposit'
    )
    for (const evt of depositEvents) {
      const attrMap = this.helper.eventsToAttrMap(evt)
      if (attrMap['bridge_id'] !== this.bridgeId.toString()) continue
      await this.handleInitiateTokenDeposit(manager, attrMap)
    }

    const finalizeEvents = events.filter(
      (evt) => evt.type === 'finalize_token_withdrawal'
    )
    for (const evt of finalizeEvents) {
      const attrMap = this.helper.eventsToAttrMap(evt)
      if (attrMap['bridge_id'] !== this.bridgeId.toString()) continue
      await this.handleFinalizeTokenWithdrawalEvent(manager, attrMap)
    }

    return true
  }
}
