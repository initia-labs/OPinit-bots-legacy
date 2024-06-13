import {
  BlockInfo,
  LCDClient,
  TxSearchOptions,
  TxSearchResult
} from 'initia-l2'
import {
  getLatestOutputFromExecutor,
  getOutputFromExecutor
} from '../../../lib/query'
import { WithdrawStorage } from '../../../lib/storage'
import { WithdrawalTx } from '../../../lib/types'
import { sha3_256 } from '../../../lib/util'
import OutputEntity from '../../../orm/executor/OutputEntity'
import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import { Block, BlockResults, RPCClient } from '../../../lib/rpc'

class MonitorHelper {
  ///
  /// DB
  ///

  public async getSyncedState<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    name: string
  ): Promise<T | null> {
    return await manager.getRepository(entityClass).findOne({
      where: { name: name } as any
    })
  }

  public async getWithdrawalTxs<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    outputIndex: number
  ): Promise<T[]> {
    return await manager.getRepository(entityClass).find({
      where: { outputIndex } as any
    })
  }

  async getDepositTx<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    sequence: number,
    metadata: string
  ): Promise<T | null> {
    return await manager.getRepository(entityClass).findOne({
      where: { sequence, metadata } as any
    })
  }

  public async getCoin<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    metadata: string
  ): Promise<T | null> {
    return await manager.getRepository(entityClass).findOne({
      where: { l2Metadata: metadata } as any
    })
  }

  public async getLastOutputFromDB<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>
  ): Promise<T | null> {
    const lastOutput = await manager.getRepository<T>(entityClass).find({
      order: { outputIndex: 'DESC' } as any,
      take: 1
    })
    return lastOutput[0] ?? null
  }

  public async getLastOutputIndex<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>
  ): Promise<number> {
    const lastOutput = await this.getLastOutputFromDB(manager, entityClass)
    const lastIndex = lastOutput ? lastOutput.outputIndex : 0
    return lastIndex
  }

  public async getOutputByIndex<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    outputIndex: number
  ): Promise<T | null> {
    return await manager.getRepository<T>(entityClass).findOne({
      where: { outputIndex } as any
    })
  }

  public async getAllOutput<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
  ): Promise<T[]> {
    return await manager.getRepository<T>(entityClass).find({
      order: { outputIndex: 'ASC' } as any
    })
  }

  public async saveEntity<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    entity: T
  ): Promise<T> {
    return await manager.getRepository(entityClass).save(entity)
  }

  ///
  ///  UTIL
  ///

  public extractErrorMessage(error: any): string {
    return error.response?.data
      ? JSON.stringify(error.response.data)
      : error.toString()
  }

  public async fetchAllEvents(
    blockResults: BlockResults | null
  ): Promise<[boolean, any[]]> {
    if (!blockResults) {
      return [true, []]
    }

    const txResults = blockResults.txs_results
    const extractAllEvents = (txs: any[]) =>
      txs
        .filter((tx) => tx.events && tx.events.length > 0)
        .flatMap((tx) => tx.events ?? [])
    const isEmpty = txResults.length === 0
    const events = extractAllEvents(txResults)

    return [isEmpty, events]
  }

  public eventsToAttrMap(event: any): { [key: string]: string } {
    return event.attributes.reduce((obj, attr) => {
      obj[attr.key] = attr.value
      return obj
    }, {})
  }

  public parseData(attrMap: { [key: string]: string }): {
    [key: string]: string;
  } {
    return JSON.parse(attrMap['data'])
  }

  // search tx without from data
  public async search(
    lcd: LCDClient,
    options: Partial<TxSearchOptions>
  ): Promise<TxSearchResult.Data> {
    const params = new URLSearchParams()

    // build search params
    options.query?.forEach((v) =>
      params.append(
        'query',
        v.key === 'tx.height' ? `${v.key}=${v.value}` : `${v.key}='${v.value}'`
      )
    )

    delete options['query']

    Object.entries(options).forEach((v) => {
      params.append(v[0], v[1] as string)
    })

    return lcd.apiRequester.getRaw<TxSearchResult.Data>(
      `/cosmos/tx/v1beta1/txs`,
      params
    )
  }

  public async feedBlock(
    rpcClient: RPCClient,
    minHeight: number,
    maxHeight: number,
    maxRetry = 3
  ): Promise<[number, Block][]> {
    const blocks = await Promise.all(
      Array.from({ length: maxHeight - minHeight + 1 }, async (_, i) => {
        let block
        let attempt = 0
        while (!block && attempt < maxRetry) {
          try {
            block = await rpcClient.getBlock(minHeight + i)
          } catch {
            if (attempt === maxRetry) {
              throw new Error('Failed to feed block')
            }
            attempt++
          }
        }
        return [minHeight + i, block as Block]
      })
    )
    return blocks as [number, Block][]
  }

  public async feedBlockResults(
    rpcClient: RPCClient,
    minHeight: number,
    maxHeight: number,
    maxRetry = 3
  ): Promise<[number, BlockResults][]> {
    const blockResults = await Promise.all(
      Array.from({ length: maxHeight - minHeight + 1 }, async (_, i) => {
        let blockResults
        let attempt = 0
        while (!blockResults && attempt < maxRetry) {
          try {
            blockResults = await rpcClient.getBlockResults(minHeight + i)
          } catch {
            if (attempt === maxRetry) {
              throw new Error('Failed to feed block results')
            }
            attempt++
          }
        }
        return [minHeight + i, blockResults as BlockResults]
      })
    )
    return blockResults as [number, BlockResults][]
  }

  ///
  /// L1 HELPER
  ///

  ///
  /// L2 HELPER
  ///

  public calculateOutputEntity(
    outputIndex: number,
    blockInfo: BlockInfo,
    merkleRoot: string,
    startBlockNumber: number,
    endBlockNumber: number
  ): OutputEntity {
    const version = outputIndex
    const stateRoot = blockInfo.block.header.app_hash
    const lastBlockHash = blockInfo.block_id.hash
    const outputRoot = sha3_256(
      Buffer.concat([
        sha3_256(version),
        Buffer.from(stateRoot, 'base64'),
        Buffer.from(merkleRoot, 'base64'),
        Buffer.from(lastBlockHash, 'base64')
      ])
    ).toString('base64')

    const outputEntity = {
      outputIndex,
      outputRoot,
      stateRoot,
      merkleRoot,
      lastBlockHash,
      startBlockNumber,
      endBlockNumber
    }

    return outputEntity
  }

  async saveMerkleRootAndProof<T extends ObjectLiteral>(
    manager: EntityManager,
    entityClass: EntityTarget<T>,
    entities: any[] // ChallengerWithdrawalTxEntity[] or ExecutorWithdrawalTxEntity[]
  ): Promise<string> {
    const txs: WithdrawalTx[] = entities.map((entity) => ({
      bridge_id: BigInt(entity.bridgeId),
      sequence: BigInt(entity.sequence),
      sender: entity.sender,
      receiver: entity.receiver,
      l1_denom: entity.l1Denom,
      amount: BigInt(entity.amount)
    }))

    const storage = new WithdrawStorage(txs)
    const merkleRoot = storage.getMerkleRoot()
    for (let i = 0; i < entities.length; i++) {
      entities[i].merkleRoot = merkleRoot
      entities[i].merkleProof = storage.getMerkleProof(txs[i])
      await this.saveEntity(manager, entityClass, entities[i])
    }
    return merkleRoot
  }

  public async getLatestOutputFromExecutor() {
    const outputRes = await getLatestOutputFromExecutor()
    if (!outputRes.output) {
      throw new Error('No output from executor')
    }
    return outputRes.output
  }

  public async getOutputFromExecutor(outputIndex: number) {
    const outputRes = await getOutputFromExecutor(outputIndex)
    if (!outputRes.output) {
      throw new Error('No output from executor')
    }
    return outputRes.output
  }
}

export default MonitorHelper
