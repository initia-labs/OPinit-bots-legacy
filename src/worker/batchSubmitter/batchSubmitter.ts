import { getDB } from '../../worker/batchSubmitter/db'
import { DataSource, EntityManager } from 'typeorm'
import { batchLogger, batchLogger as logger } from '../../lib/logger'
import { BlockBulk, RawCommit, RPCClient } from '../../lib/rpc'
import { compress } from '../../lib/compressor'
import { ExecutorOutputEntity, RecordEntity } from '../../orm'
import {
  MnemonicKey,
  MsgRecordBatch,
  MsgPayForBlobs,
  BlobTx,
  TxAPI
} from 'initia-l2'
import { delay } from 'bluebird'
import { INTERVAL_BATCH } from '../../config'
import { config } from '../../config'
import MonitorHelper from '../bridgeExecutor/monitor/helper'
import { createBlob, getCelestiaFeeGasLimit } from '../../celestia/utils'
import { bech32 } from 'bech32'
import { TxWalletL1 } from '../../lib/walletL1'
import { BatchError, BatchErrorTypes } from './error'
import { updateBatchUsageMetrics } from '../../lib/metrics'

const base = 200000
const perByte = 10
const maxBytes = 500000 // 500kb
const maxBulkSize = 1000

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
      updateBatchUsageMetrics()
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

      for (
        let i = output.startBlockNumber;
        i <= output.endBlockNumber;
        i += maxBulkSize
      ) {
        await this.processBatchRange(
          manager,
          i,
          Math.min(i + maxBulkSize - 1, output.endBlockNumber)
        )
      }

      logger.info(
        `${this.batchIndex}th batch (${output.startBlockNumber}, ${output.endBlockNumber}) is successfully saved`
      )
    })
  }

  async processBatchRange(manager: EntityManager, start: number, end: number) {
    const batch = await this.getBatch(start, end)
    const batchInfo: string[] = await this.publishBatch(batch)
    await this.saveBatchToDB(manager, batchInfo, this.batchIndex, start, end)
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

  // Publish a batch to L1
  async publishBatch(batch: Buffer): Promise<string[]> {
    const batchInfos: string[] = []

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
      switch (config.PUBLISH_BATCH_TARGET) {
        case 'l1':
          txBytes = await this.createL1BatchMessage(subData)
          break
        case 'celestia':
          txBytes = await this.createCelestiaBatchMessage(subData)
          break
        default:
          throw new BatchError(BatchErrorTypes.EUNKNOWN_TARGET)
      }

      const batchInfo = await this.submitter.sendRawTx(txBytes, 60 * 10 * 1000)
      batchInfos.push(batchInfo.txhash)

      await delay(1000) // break for each tx ended
    }

    return batchInfos
  }

  async createL1BatchMessage(data: Buffer): Promise<string> {
    const gasLimit = Math.floor((base + perByte * data.length) * 1.2)
    const fee = this.submitter.getFee(gasLimit)

    if (!this.submitterAddress) {
      this.submitterAddress = this.submitter.key.accAddress
    }

    const msg = new MsgRecordBatch(
      this.submitterAddress,
      this.bridgeId,
      data.toString('base64')
    )

    const signedTx = await this.submitter.createAndSignTx({ msgs: [msg], fee })
    return TxAPI.encode(signedTx)
  }

  async createCelestiaBatchMessage(data: Buffer): Promise<string> {
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
    return Buffer.from(blobTx.toBytes()).toString('base64')
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
    return record
  }
}
