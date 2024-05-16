import { getDB } from '../../lib/db'
import { DataSource, EntityManager } from 'typeorm'
import { batchLogger, batchLogger as logger } from '../../lib/logger'
import { BlockBulk, RawCommit, RPCClient } from '../../lib/rpc'
import { compress } from '../../lib/compressor'
import { BatchTxEntity, ExecutorOutputEntity, RecordEntity } from '../../orm'
import {
  MnemonicKey,
  MsgRecordBatch,
  MsgPayForBlobs,
  BlobTx,
  TxAPI,
  Tx,
  TxInfo
} from 'initia-l2'
import { delay } from 'bluebird'
import { INTERVAL_BATCH } from '../../config'
import { config } from '../../config'
import MonitorHelper from '../../lib/monitor/helper'
import { createBlob, getCelestiaFeeGasLimit } from '../../celestia/utils'
import { bech32 } from 'bech32'
import { TxWalletL1 } from '../../lib/walletL1'
import { BatchError, BatchErrorTypes } from './error'

const base = 200000
const perByte = 10
const maxBytes = 500000 // 500kb

export class BatchSubmitter {
  private submitterAddress: string
  private batchIndex = 0
  private db: DataSource
  private submitter: TxWalletL1
  private bridgeId: number
  private isRunning = false
  private rpcClient: RPCClient
  helper: MonitorHelper = new MonitorHelper()

  async init() {
    [this.db] = getDB()
    this.rpcClient = new RPCClient(config.L2_RPC_URI, batchLogger)
    this.submitter = new TxWalletL1(
      config.batchlcd,
      new MnemonicKey({ mnemonic: config.BATCH_SUBMITTER_MNEMONIC })
    )

    this.bridgeId = config.BRIDGE_ID
    this.isRunning = true
  }

  public stop() {
    this.isRunning = false
  }

  public async run() {
    await this.init()

    while (this.isRunning) {
      await this.processBatch()
      await delay(INTERVAL_BATCH)
    }
  }

  async processBatch() {
    await this.db.transaction(async (manager: EntityManager) => {
      const latestBatch = await this.getStoredBatch(manager)
      this.batchIndex = latestBatch ? latestBatch.batchIndex + 1 : 1
      const output = await this.helper.getOutputByIndex(
        manager,
        ExecutorOutputEntity,
        this.batchIndex
      )

      if (!output) {
        logger.info(`waiting for output index from DB: ${this.batchIndex}`)
        return
      }

      const batch = await this.getBatch(
        output.startBlockNumber,
        output.endBlockNumber
      )
      const batchInfo: string[] = await this.publishBatch(manager, batch)
      await this.saveBatchToDB(
        manager,
        batchInfo,
        this.batchIndex,
        output.startBlockNumber,
        output.endBlockNumber
      )
      logger.info(
        `${this.batchIndex}th batch (${output.startBlockNumber}, ${output.endBlockNumber}) is successfully saved`
      )
    })
  }

  // Get [start, end] batch from L2 and last commit info
  async getBatch(start: number, end: number): Promise<Buffer> {
    const bulk: BlockBulk | null = await this.rpcClient.getBlockBulk(
      start.toString(),
      end.toString()
    )
    if (!bulk) {
      throw new BatchError(BatchErrorTypes.EBLOCK_BULK)
    }

    const commit: RawCommit | null = await this.rpcClient.getRawCommit(
      end.toString()
    )
    if (!commit) {
      throw new BatchError(BatchErrorTypes.ERAW_COMMIT)
    }

    const reqStrings = bulk.blocks.concat(commit.commit)
    return compress(reqStrings)
  }

  async getStoredBatch(manager: EntityManager): Promise<RecordEntity | null> {
    const storedRecord = await manager.getRepository(RecordEntity).find({
      order: {
        batchIndex: 'DESC'
      },
      take: 1
    })

    return storedRecord[0] ?? null
  }

  async createBatch(manager: EntityManager, batch: Buffer): Promise<void> {
    let batchSubIndex = 0
    const batchTxEntites: BatchTxEntity[] = []
    while (batch.length !== 0) {
      let subData: Buffer
      if (batch.length > maxBytes) {
        subData = batch.slice(0, maxBytes)
        batch = batch.slice(maxBytes)
      } else {
        subData = batch
        batch = Buffer.from([])
      }

      let txBytes: string
      let signedTx: Tx
      switch (config.PUBLISH_BATCH_TARGET) {
        case 'l1':
          [txBytes, signedTx] = await this.createL1BatchMessage(subData)
          break
        case 'celestia':
          [txBytes, signedTx] = await this.createCelestiaBatchMessage(subData)
          break
        default:
          throw new BatchError(BatchErrorTypes.EUNKNOWN_TARGET)
      }

      // check txBytes not in batchTxEntity
      const txhash = TxAPI.hash(signedTx)
      const batchTxEntity: BatchTxEntity = {
        hash: txhash,
        batchIndex: this.batchIndex,
        subIndex: batchSubIndex,
        txBytes: txBytes
      }
      batchTxEntites.push(batchTxEntity)
      batchSubIndex++
    }
    await manager.getRepository(BatchTxEntity).save(batchTxEntites)
  }

  // Publish a batch to L1
  async publishBatch(manager: EntityManager, batch: Buffer): Promise<string[]> {
    await this.createBatch(manager, batch)
    logger.info(`batch ${this.batchIndex} is created`)
    const batchTxEntites = await manager.getRepository(BatchTxEntity).find({
      where: {
        batchIndex: this.batchIndex
      },
      order: {
        subIndex: 'ASC'
      }
    })

    await this.submitTransaction(batchTxEntites)
    return batchTxEntites.map((batchTx) => batchTx.hash)
  }

  async submitTransaction(batchTxEntites: BatchTxEntity[]): Promise<void> {
    const POLLING_INTERVAL = 10_000
    const MAX_RETRIES = 60
    for (const batchTx of batchTxEntites) {
      const txInfo = await this.getTransaction(batchTx.hash)
      if (txInfo) continue
      await this.submitter.sendRawTx(batchTx.txBytes)
      let i = 0
      do {
        const txInfo = await this.getTransaction(batchTx.hash)
        if (txInfo) break
        logger.info(`waiting for tx ${batchTx.hash} to be included in a block`)
        await delay(POLLING_INTERVAL)
        if (i === MAX_RETRIES) {
          throw new BatchError(BatchErrorTypes.EMAX_RETRIES)
        }
      } while (i++)
    }
  }

  async getTransaction(txHash: string): Promise<TxInfo | null> {
    return await config.l1lcd.tx.txInfo(txHash).catch(() => {
      return null // ignore not found error
    })
  }

  async createL1BatchMessage(data: Buffer): Promise<[string, Tx]> {
    const gasLimit = Math.floor((base + perByte * data.length) * 1.2)
    const fee = this.submitter.getFee(gasLimit)

    if (!this.submitterAddress) {
      this.submitterAddress = this.submitter.key.accAddress
      logger.info(`submitter address: ${this.submitterAddress}`)
    }

    const msg = new MsgRecordBatch(
      this.submitterAddress,
      this.bridgeId,
      data.toString('base64')
    )

    const signedTx = await this.submitter.createAndSignTx({ msgs: [msg], fee })
    return [TxAPI.encode(signedTx), signedTx]
  }

  async createCelestiaBatchMessage(data: Buffer): Promise<[string, Tx]> {
    const blob = createBlob(data)
    const gasLimit = getCelestiaFeeGasLimit(data.length)
    const fee = this.submitter.getFee(gasLimit)

    const rawAddress = this.submitter.key.publicKey?.rawAddress()
    if (!rawAddress) {
      throw new BatchError(BatchErrorTypes.EPUBLIC_KEY_NOT_SET)
    }

    if (!this.submitterAddress) {
      this.submitterAddress = bech32.encode(
        'celestia',
        bech32.toWords(rawAddress)
      )
      this.submitter.setAccountAddress(this.submitterAddress)
    }

    const msg = new MsgPayForBlobs(
      this.submitterAddress,
      [blob.namespace],
      [data.length],
      [blob.commitment],
      [blob.blob.share_version]
    )
    const signedTx = await this.submitter.createAndSignTx({ msgs: [msg], fee })
    const blobTx = new BlobTx(signedTx, [blob.blob], 'BLOB')
    return [Buffer.from(blobTx.toBytes()).toString('base64'), signedTx]
  }

  // Save batch record to database
  async saveBatchToDB(
    manager: EntityManager,
    batchInfo: string[],
    batchIndex: number,
    startBlockNumber: number,
    endBlockNumber: number
  ): Promise<RecordEntity> {
    const record = new RecordEntity()

    record.bridgeId = this.bridgeId
    record.batchIndex = batchIndex
    record.batchInfo = batchInfo
    record.startBlockNumber = startBlockNumber
    record.endBlockNumber = endBlockNumber

    await manager.getRepository(RecordEntity).save(record)
    await manager.getRepository(BatchTxEntity).delete({
      batchIndex: batchIndex
    })
    return record
  }
}
